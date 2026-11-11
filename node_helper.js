/* Magic Mirror
 * Module: MMM-Bambulink
 */

"use strict";

const NodeHelper = require("node_helper");
const mqtt = require("mqtt");

module.exports = NodeHelper.create({
  start: function () {
    this.config = null;
    this.client = null;
    this.connectionState = "connecting";
    this.lastMessageAt = null;
    this.watchdog = null;
    this.log("MMM-Bambulink helper started");
  },

  log: function (msg) {
    console.log("MMM-Bambulink:", msg);
  },

  stop: function () {
    this.stopWatchdog();
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "BAMBULINK_CONFIG") {
      this.config = payload;
      this.connectMqtt();
    } else if (notification === "BAMBULINK_REQUEST_STATUS") {
      // L'imprimante envoie ses statuts en continu via MQTT ; on renvoie
      // simplement l'état de connexion courant (utile après un rechargement du front).
      this.sendConnectionState();
    }
  },

  // Met à jour et diffuse l'état de connexion : "connecting" | "online" | "offline"
  setConnectionState: function (state, reason) {
    const changed = (this.connectionState !== state);
    this.connectionState = state;
    if (changed) {
      this.log(`Etat connexion: ${state}${reason ? " (" + reason + ")" : ""}`);
    }
    this.sendConnectionState(reason);
  },

  sendConnectionState: function (reason) {
    this.sendSocketNotification("BAMBULINK_CONNECTION", {
      state: this.connectionState,
      reason: reason || null,
      lastMessageAt: this.lastMessageAt
    });
  },

  // Une imprimante éteinte ne ferme pas toujours proprement la connexion TCP :
  // si aucun message n'arrive pendant offlineTimeout, on la considère hors ligne.
  startWatchdog: function () {
    this.stopWatchdog();
    const self = this;
    const timeout = Number(this.config.offlineTimeout) || 60000;
    this.watchdog = setInterval(function () {
      if (self.connectionState === "online" && self.lastMessageAt &&
          Date.now() - self.lastMessageAt > timeout) {
        self.setConnectionState("offline", "aucune donnée reçue");
        // Force une reconnexion propre.
        self.connectMqtt(true);
      }
    }, 5000);
  },

  stopWatchdog: function () {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  },

  requestFullStatus: function () {
    if (!this.client || !this.client.connected) return;
    const topic = `device/${this.config.serial}/request`;
    const payload = JSON.stringify({
      pushing: { sequence_id: String(Date.now()), command: "pushall" }
    });
    this.client.publish(topic, payload);
  },

  connectMqtt: function (keepState) {
    if (!this.config || !this.config.ip || !this.config.accessCode || !this.config.serial) {
      this.log("Configuration incomplète pour MQTT");
      return;
    }

    if (this.client) {
      this.client.end(true);
      this.client = null;
    }

    const host = this.config.ip;
    const port = this.config.mqttPort || 8883;
    const useTLS = (this.config.useTLS !== false);

    const url = useTLS
      ? `mqtts://${host}:${port}`
      : `mqtt://${host}:${port}`;

    const options = {
      username: "bblp",
      password: this.config.accessCode,
      rejectUnauthorized: false,
      keepalive: 30,          // détecte plus vite une imprimante éteinte
      connectTimeout: 10000,  // échec de connexion après 10 s
      reconnectPeriod: 10000  // nouvelle tentative toutes les 10 s
    };

    this.log(`Connexion MQTT à ${url}`);
    if (!keepState) {
      this.setConnectionState("connecting");
    }
    const client = mqtt.connect(url, options);
    this.client = client;

    const self = this;
    // Ignore les événements d'un ancien client remplacé par une reconnexion.
    const isCurrent = function () { return self.client === client; };
    this.startWatchdog();

    client.on("connect", function () {
      if (!isCurrent()) return;
      self.log("Connecté au broker MQTT Bambu");
      self.lastMessageAt = Date.now();

      const topic = `device/${self.config.serial}/report`;
      client.subscribe(topic, function (err) {
        if (err) {
          self.log("Erreur abonnement topic: " + err);
        } else {
          self.log("Abonné au topic: " + topic);
          // Demande un état complet pour ne pas attendre le prochain rapport.
          self.requestFullStatus();
        }
      });
    });

    client.on("error", function (err) {
      if (!isCurrent()) return;
      self.log("Erreur MQTT: " + err);
      self.setConnectionState("offline", err && err.message ? err.message : String(err));
    });

    client.on("close", function () {
      if (!isCurrent()) return;
      self.log("Connexion MQTT fermée");
      self.setConnectionState("offline", "connexion fermée");
    });

    client.on("offline", function () {
      if (!isCurrent()) return;
      self.setConnectionState("offline", "imprimante injoignable");
    });

    client.on("reconnect", function () {
      if (!isCurrent()) return;
      self.log("Tentative de reconnexion MQTT…");
    });

    client.on("message", function (topic, message) {
      if (!isCurrent()) return;
      let json;
      try {
        json = JSON.parse(message.toString());
      } catch (e) {
        self.log("JSON invalide reçu: " + e);
        return;
      }

      self.lastMessageAt = Date.now();
      if (self.connectionState !== "online") {
        self.setConnectionState("online");
      }

      // Certains messages (réponses aux commandes, info…) ne contiennent pas de bloc "print".
      if (!json || !json.print) {
        return;
      }

      const status = self.extractStatus(json);
      self.sendSocketNotification("BAMBULINK_STATUS", status);
    });
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

      // AMS / filament
      ams_tray_now: undefined,
      ams_tray_type: undefined,
      ams_tray_color: undefined,
      ams_humidity: undefined,
      ams_temp: undefined,
      ams_slots: [],

      // Température chambre
      chamber_temp: undefined,

      // Réseau
      wifi_signal: p.wifi_signal
    };

    // AMS : slot courant + humidité + température AMS + liste complète des slots
    if (p.ams && Array.isArray(p.ams.ams) && p.ams.ams.length > 0) {
      const trayNow = (p.ams.tray_now !== undefined && p.ams.tray_now !== null)
        ? String(p.ams.tray_now)
        : null;

      const ams0 = p.ams.ams[0];

      if (ams0.humidity_raw !== undefined) {
        status.ams_humidity = ams0.humidity_raw;
      }

      if (ams0.temp !== undefined) {
        status.ams_temp = ams0.temp;
      }

      if (Array.isArray(ams0.tray)) {
        status.ams_slots = ams0.tray.map(function (tray) {
          return {
            id: tray.id,
            tray_type: (tray.tray_type !== undefined && tray.tray_type !== null && tray.tray_type !== "")
              ? tray.tray_type
              : "Vide",
            tray_color: (tray.tray_color !== undefined && tray.tray_color !== null && tray.tray_color !== "")
              ? tray.tray_color
              : null
          };
        });

        if (trayNow !== null) {
          const currentTray = ams0.tray.find(function (t) {
            return String(t.id) === trayNow;
          });

          if (currentTray) {
            status.ams_tray_now = currentTray.id;
            status.ams_tray_type = (currentTray.tray_type !== undefined && currentTray.tray_type !== null && currentTray.tray_type !== "")
              ? currentTray.tray_type
              : "Vide";
            status.ams_tray_color = (currentTray.tray_color !== undefined && currentTray.tray_color !== null && currentTray.tray_color !== "")
              ? currentTray.tray_color
              : null;
          }
        }
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