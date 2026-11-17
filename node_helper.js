/* Magic Mirror
 * Module: MMM-Bambulink
 */

"use strict";

const NodeHelper = require("node_helper");
const mqtt = require("mqtt");

// Intervalle minimal entre deux demandes d'état complet ("pushall").
// Les imprimantes (surtout les P1) ralentissent si on les sollicite trop souvent.
const MIN_PUSHALL_INTERVAL = 60 * 1000;
const DEFAULT_PUSHALL_INTERVAL = 5 * 60 * 1000;

// Valeurs spéciales de "tray_now" dans le rapport AMS.
const TRAY_EXTERNAL = 254; // bobine externe
const TRAY_NONE = 255;     // aucun filament chargé

module.exports = NodeHelper.create({
  start: function () {
    // Un seul node_helper est partagé par toutes les instances du module :
    // chaque instance (une par imprimante) a donc sa propre "session",
    // indexée par l'identifiant de l'instance.
    this.sessions = {};
    this.log("MMM-Bambulink helper started");
  },

  log: function (msg, session) {
    const prefix = session ? `MMM-Bambulink [${session.config.serial}]:` : "MMM-Bambulink:";
    console.log(prefix, msg);
  },

  stop: function () {
    const self = this;
    Object.keys(this.sessions).forEach(function (id) {
      self.closeSession(self.sessions[id]);
    });
    this.sessions = {};
  },

  socketNotificationReceived: function (notification, payload) {
    // Une exception non attrapée ici ferait tomber tout le serveur MagicMirror.
    try {
      const identifier = payload && payload.identifier;
      if (!identifier) {
        this.log(`Notification ${notification} sans identifiant ignorée`);
        return;
      }

      if (notification === "BAMBULINK_CONFIG") {
        this.openSession(identifier, payload.config || {});
        return;
      }

      const session = this.sessions[identifier];
      if (!session) {
        return;
      }

      if (notification === "BAMBULINK_REQUEST_STATUS") {
        // L'imprimante envoie ses statuts en continu via MQTT ; on renvoie
        // simplement l'état de connexion courant (utile après un rechargement du front).
        this.sendConnectionState(session);
      } else if (notification === "BAMBULINK_SUSPEND") {
        // Module masqué : on garde la connexion (le graphe continue de se remplir)
        // mais on arrête de solliciter l'imprimante.
        session.suspended = true;
        this.stopPushallTimer(session);
      } else if (notification === "BAMBULINK_RESUME") {
        session.suspended = false;
        this.requestFullStatus(session);
        this.startPushallTimer(session);
      }
    } catch (e) {
      this.log("Erreur inattendue (" + notification + "): " + (e && e.stack ? e.stack : e));
    }
  },

  // ---------------------------------------------------------------------------
  // Sessions (une par instance du module)
  // ---------------------------------------------------------------------------

  openSession: function (identifier, config) {
    // Rechargement du front : la même instance renvoie sa config, on repart à zéro.
    if (this.sessions[identifier]) {
      this.closeSession(this.sessions[identifier]);
    }

    const session = {
      identifier: identifier,
      config: config,
      client: null,
      connectionState: "connecting",
      lastMessageAt: null,
      watchdog: null,
      pushallTimer: null,
      suspended: false,
      // Copie cumulée du bloc "print" : les P1 / A1 n'envoient que les champs
      // modifiés, l'état complet n'arrive qu'en réponse à un "pushall".
      printCache: {}
    };
    this.sessions[identifier] = session;
    this.connectMqtt(session);
  },

  closeSession: function (session) {
    this.stopWatchdog(session);
    this.stopPushallTimer(session);
    if (session.client) {
      try {
        session.client.end(true);
      } catch (e) {
        this.log("Erreur à la fermeture MQTT: " + e, session);
      }
      session.client = null;
    }
  },

  // ---------------------------------------------------------------------------
  // État de connexion : "connecting" | "online" | "offline"
  // ---------------------------------------------------------------------------

  setConnectionState: function (session, state, reason) {
    const changed = (session.connectionState !== state);
    session.connectionState = state;
    if (changed) {
      this.log(`Etat connexion: ${state}${reason ? " (" + reason + ")" : ""}`, session);
    }
    this.sendConnectionState(session, reason);
  },

  sendConnectionState: function (session, reason) {
    this.sendSocketNotification("BAMBULINK_CONNECTION", {
      identifier: session.identifier,
      state: session.connectionState,
      reason: reason || null,
      lastMessageAt: session.lastMessageAt
    });
  },

  // Une imprimante éteinte ne ferme pas toujours proprement la connexion TCP :
  // si aucun message n'arrive pendant offlineTimeout, on la considère hors ligne.
  startWatchdog: function (session) {
    this.stopWatchdog(session);
    const self = this;
    const timeout = Number(session.config.offlineTimeout) || 60000;
    session.watchdog = setInterval(function () {
      try {
        if (session.connectionState === "online" && session.lastMessageAt &&
            Date.now() - session.lastMessageAt > timeout) {
          self.setConnectionState(session, "offline", "aucune donnée reçue");
          // Force une reconnexion propre.
          self.connectMqtt(session, true);
        }
      } catch (e) {
        self.log("Erreur watchdog: " + e, session);
      }
    }, 5000);
  },

  stopWatchdog: function (session) {
    if (session.watchdog) {
      clearInterval(session.watchdog);
      session.watchdog = null;
    }
  },

  // ---------------------------------------------------------------------------
  // Demande d'état complet ("pushall")
  // ---------------------------------------------------------------------------

  // Retourne l'intervalle en ms, ou 0 si désactivé.
  getPushallInterval: function (session) {
    const raw = session.config.pushallInterval;
    if (raw === undefined || raw === null || raw === "") {
      return DEFAULT_PUSHALL_INTERVAL;
    }
    const value = Number(raw);
    if (isNaN(value) || value <= 0) {
      return 0;
    }
    return Math.max(value, MIN_PUSHALL_INTERVAL);
  },

  startPushallTimer: function (session) {
    this.stopPushallTimer(session);
    const interval = this.getPushallInterval(session);
    if (!interval || session.suspended) {
      return;
    }
    const self = this;
    session.pushallTimer = setInterval(function () {
      self.requestFullStatus(session);
    }, interval);
  },

  stopPushallTimer: function (session) {
    if (session.pushallTimer) {
      clearInterval(session.pushallTimer);
      session.pushallTimer = null;
    }
  },

  requestFullStatus: function (session) {
    if (!session.client || !session.client.connected) return;
    try {
      const topic = `device/${session.config.serial}/request`;
      const payload = JSON.stringify({
        pushing: { sequence_id: String(Date.now()), command: "pushall" }
      });
      session.client.publish(topic, payload);
    } catch (e) {
      this.log("Erreur envoi pushall: " + e, session);
    }
  },

  // ---------------------------------------------------------------------------
  // Connexion MQTT
  // ---------------------------------------------------------------------------

  connectMqtt: function (session, keepState) {
    const config = session.config;
    if (!config || !config.ip || !config.accessCode || !config.serial) {
      this.log("Configuration incomplète pour MQTT (ip / accessCode / serial)");
      return;
    }

    if (session.client) {
      try {
        session.client.end(true);
      } catch (e) {
        this.log("Erreur à la fermeture MQTT: " + e, session);
      }
      session.client = null;
    }

    const host = config.ip;
    const port = config.mqttPort || 8883;
    const useTLS = (config.useTLS !== false);

    const url = useTLS
      ? `mqtts://${host}:${port}`
      : `mqtt://${host}:${port}`;

    const options = {
      username: "bblp",
      password: config.accessCode,
      // Les imprimantes Bambu utilisent un certificat auto-signé.
      rejectUnauthorized: false,
      keepalive: 30,          // détecte plus vite une imprimante éteinte
      connectTimeout: 10000,  // échec de connexion après 10 s
      reconnectPeriod: 10000  // nouvelle tentative toutes les 10 s
    };

    this.log(`Connexion MQTT à ${url}`, session);
    if (!keepState) {
      this.setConnectionState(session, "connecting");
    }

    let client;
    try {
      client = mqtt.connect(url, options);
    } catch (e) {
      this.setConnectionState(session, "offline", "connexion impossible: " + (e && e.message ? e.message : e));
      return;
    }
    session.client = client;

    const self = this;
    // Ignore les événements d'un ancien client remplacé par une reconnexion
    // ou d'une session fermée.
    const isCurrent = function () {
      return session.client === client && self.sessions[session.identifier] === session;
    };
    this.startWatchdog(session);
    this.startPushallTimer(session);

    client.on("connect", function () {
      if (!isCurrent()) return;
      self.log("Connecté au broker MQTT Bambu", session);
      session.lastMessageAt = Date.now();

      const topic = `device/${config.serial}/report`;
      client.subscribe(topic, function (err) {
        if (!isCurrent()) return;
        if (err) {
          self.log("Erreur abonnement topic: " + err, session);
        } else {
          self.log("Abonné au topic: " + topic, session);
          // Demande un état complet pour ne pas attendre le prochain rapport.
          self.requestFullStatus(session);
        }
      });
    });

    client.on("error", function (err) {
      if (!isCurrent()) return;
      self.log("Erreur MQTT: " + err, session);
      self.setConnectionState(session, "offline", err && err.message ? err.message : String(err));
    });

    client.on("close", function () {
      if (!isCurrent()) return;
      self.log("Connexion MQTT fermée", session);
      self.setConnectionState(session, "offline", "connexion fermée");
    });

    client.on("offline", function () {
      if (!isCurrent()) return;
      self.setConnectionState(session, "offline", "imprimante injoignable");
    });

    client.on("reconnect", function () {
      if (!isCurrent()) return;
      self.log("Tentative de reconnexion MQTT…", session);
    });

    client.on("message", function (topic, message) {
      if (!isCurrent()) return;
      try {
        let json;
        try {
          json = JSON.parse(message.toString());
        } catch (e) {
          self.log("JSON invalide reçu: " + e, session);
          return;
        }

        session.lastMessageAt = Date.now();
        if (session.connectionState !== "online") {
          self.setConnectionState(session, "online");
        }

        // Certains messages (réponses aux commandes, info…) ne contiennent pas de bloc "print".
        if (!json || !json.print) {
          return;
        }

        // Rapports incrémentaux : on fusionne le message dans l'état connu
        // pour ne pas perdre les champs absents (AMS, couche, températures…).
        self.mergeDeep(session.printCache, json.print);
        const status = self.extractStatus({ print: session.printCache });
        status.identifier = session.identifier;
        self.sendSocketNotification("BAMBULINK_STATUS", status);
      } catch (e) {
        self.log("Erreur traitement message: " + (e && e.stack ? e.stack : e), session);
      }
    });
  },

  // ---------------------------------------------------------------------------
  // Fusion des rapports incrémentaux
  // ---------------------------------------------------------------------------

  isPlainObject: function (value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  },

  // Fusionne récursivement "source" dans "target" (modifié en place).
  // Les objets sont fusionnés clé par clé ; les tableaux d'objets portant un
  // "id" (ams.ams, tray…) sont fusionnés élément par élément selon cet id ;
  // les autres valeurs (y compris les autres tableaux) remplacent l'ancienne.
  mergeDeep: function (target, source) {
    if (!this.isPlainObject(target) || !this.isPlainObject(source)) {
      return source;
    }
    const self = this;
    Object.keys(source).forEach(function (key) {
      // Protection contre la pollution de prototype.
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        return;
      }
      const incoming = source[key];
      const current = target[key];
      if (Array.isArray(incoming)) {
        target[key] = self.mergeArrayById(current, incoming);
      } else if (self.isPlainObject(incoming) && self.isPlainObject(current)) {
        self.mergeDeep(current, incoming);
      } else {
        target[key] = incoming;
      }
    });
    return target;
  },

  // Fusionne deux tableaux d'objets selon leur champ "id".
  // Si le nouveau tableau ne contient pas que des objets avec un id
  // (ou s'il est vide), il remplace simplement l'ancien.
  mergeArrayById: function (current, incoming) {
    const self = this;
    const hasId = function (item) {
      return self.isPlainObject(item) && self.isFilled(item.id);
    };
    if (!Array.isArray(current) || incoming.length === 0 || !incoming.every(hasId)) {
      return incoming;
    }

    const result = current.slice();
    incoming.forEach(function (item) {
      const index = result.findIndex(function (old) {
        return hasId(old) && String(old.id) === String(item.id);
      });
      // Un élément réduit à son id (ex. emplacement AMS vidé) remplace l'ancien
      // au lieu d'en conserver les anciennes valeurs (type, couleur…).
      const onlyId = Object.keys(item).length === 1;
      if (index === -1) {
        result.push(item);
      } else if (onlyId || !self.isPlainObject(result[index])) {
        result[index] = item;
      } else {
        self.mergeDeep(result[index], item);
      }
    });
    return result;
  },

  // ---------------------------------------------------------------------------
  // Traduction du JSON Bambu
  // ---------------------------------------------------------------------------

  isFilled: function (value) {
    return value !== undefined && value !== null && value !== "";
  },

  // Nom d'un AMS : "AMS 1", "AMS 2"… ou "AMS HT 1" pour les AMS HT (id >= 128).
  amsLabel: function (amsId) {
    return (amsId >= 128) ? `AMS HT ${amsId - 127}` : `AMS ${amsId + 1}`;
  },

  // Nom d'un emplacement, comme dans Bambu Studio : A1…A4, B1…B4, HT1…
  slotLabel: function (amsId, trayId) {
    if (amsId >= 128) {
      return `HT${amsId - 127}`;
    }
    const letter = String.fromCharCode(65 + (amsId % 26));
    return `${letter}${trayId + 1}`;
  },

  // Numéro global d'un emplacement tel qu'utilisé par "tray_now" :
  // AMS standard => n° AMS × 4 + n° emplacement ; AMS HT => son propre id.
  globalTrayIndex: function (amsId, trayId) {
    return (amsId >= 128) ? amsId : amsId * 4 + trayId;
  },

  // Liste de tous les AMS avec leurs emplacements.
  extractAmsUnits: function (amsBlock) {
    const self = this;
    if (!amsBlock || !Array.isArray(amsBlock.ams)) {
      return { units: [], trayNow: null };
    }

    let trayNow = null;
    if (this.isFilled(amsBlock.tray_now)) {
      const n = Number(amsBlock.tray_now);
      if (!isNaN(n) && n !== TRAY_NONE && n !== TRAY_EXTERNAL) {
        trayNow = n;
      }
    }

    const isObject = function (v) { return v !== null && typeof v === "object"; };

    const units = amsBlock.ams.filter(isObject).map(function (ams, index) {
      const amsId = self.isFilled(ams.id) && !isNaN(Number(ams.id)) ? Number(ams.id) : index;
      const trays = Array.isArray(ams.tray) ? ams.tray.filter(isObject) : [];

      const slots = trays.map(function (tray, trayIndex) {
        const trayId = self.isFilled(tray.id) && !isNaN(Number(tray.id)) ? Number(tray.id) : trayIndex;
        const globalId = self.globalTrayIndex(amsId, trayId);
        return {
          id: trayId,
          global_id: globalId,
          label: self.slotLabel(amsId, trayId),
          tray_type: self.isFilled(tray.tray_type) ? tray.tray_type : "Vide",
          tray_color: self.isFilled(tray.tray_color) ? tray.tray_color : null,
          active: (trayNow !== null && globalId === trayNow)
        };
      });

      return {
        id: amsId,
        label: self.amsLabel(amsId),
        humidity: self.isFilled(ams.humidity_raw) ? ams.humidity_raw : undefined,
        temp: self.isFilled(ams.temp) ? ams.temp : undefined,
        slots: slots
      };
    });

    return { units: units, trayNow: trayNow };
  },

  // Mappe le JSON Bambu vers un objet simple pour le front.
  extractStatus: function (data) {
    const p = data.print || {};

    const status = {
      // État / job
      state: p.gcode_state,
      job_state: p.job && p.job.job_state,
      subtask_name: p.subtask_name,
      job_id: p.job_id,

      // Progression
      progress: (p.percent !== undefined) ? p.percent : p.mc_percent,
      layer_num: p.layer_num,
      total_layer_num: p.total_layer_num,

      // Temps restant (en minutes, conversion en j/h/min côté front)
      remaining_time: (p.remain_time !== undefined)
        ? p.remain_time
        : p.mc_remaining_time,

      // Températures buse / lit
      nozzle_temp: p.nozzle_temper,
      nozzle_target: p.nozzle_target_temper,
      bed_temp: p.bed_temper,
      bed_target: p.bed_target_temper,

      // Vitesse
      speed_level: p.spd_lvl,
      speed_mag: p.spd_mag,

      // AMS : tous les AMS connectés, chacun avec ses emplacements
      ams_units: [],
      ams_tray_now: undefined,
      ams_tray_type: undefined,
      ams_tray_color: undefined,

      // Température chambre
      chamber_temp: undefined,

      // Réseau
      wifi_signal: p.wifi_signal
    };

    if (p.ams) {
      const ams = this.extractAmsUnits(p.ams);
      status.ams_units = ams.units;

      if (ams.trayNow !== null) {
        status.ams_tray_now = ams.trayNow;
        ams.units.forEach(function (unit) {
          unit.slots.forEach(function (slot) {
            if (slot.active) {
              status.ams_tray_type = slot.tray_type;
              status.ams_tray_color = slot.tray_color;
            }
          });
        });
      }
    }

    // Température chambre : info.temp ou device.ctc.info.temp suivant le firmware
    if (p.info && typeof p.info.temp !== "undefined") {
      status.chamber_temp = p.info.temp;
    } else if (p.device && p.device.ctc && p.device.ctc.info && typeof p.device.ctc.info.temp !== "undefined") {
      status.chamber_temp = p.device.ctc.info.temp;
    }

    if (!status.state && typeof p.state !== "undefined") {
      status.state = p.state;
    }

    if (!status.state) {
      status.state = "Unknown";
    }

    return status;
  }
});
