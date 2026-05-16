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
    this.connected = false;
    this.log("MMM-Bambulink helper started");
  },

  log: function (msg) {
    console.log("MMM-Bambulink:", msg);
  },

  stop: function () {
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
      // Pas besoin de pull actif: la Bambu push déjà régulièrement son status.
    }
  },

  connectMqtt: function () {
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
      username: "bblp",                 // Utilisateur MQTT Bambu.
      password: this.config.accessCode, // Access code LAN comme mot de passe.
      rejectUnauthorized: false         // Certificat TLS non signé sur l'imprimante.
    };

    this.log(`Connexion MQTT à ${url}`);
    this.client = mqtt.connect(url, options);

    const self = this;

    this.client.on("connect", function () {
      self.connected = true;
      self.log("Connecté au broker MQTT Bambu");

      const topic = `device/${self.config.serial}/report`; // Topic status.
      self.client.subscribe(topic, function (err) {
        if (err) {
          self.log("Erreur abonnement topic: " + err);
        } else {
          self.log("Abonné au topic: " + topic);
        }
      });
    });

    this.client.on("error", function (err) {
      self.log("Erreur MQTT: " + err);
    });

    this.client.on("close", function () {
      self.connected = false;
      self.log("Connexion MQTT fermée");
    });

    this.client.on("message", function (topic, message) {
      let json;
      try {
        json = JSON.parse(message.toString());
      } catch (e) {
        self.log("JSON invalide reçu: " + e);
        return;
      }

      const status = self.extractStatus(json);
      self.sendSocketNotification("BAMBULINK_STATUS", status);
    });
  },

  // Mappe le JSON Bambu (comme celui que tu as envoyé) vers un objet simple
  extractStatus: function (data) {
    const p = data.print || {};
    const status = {
      // État / job
      state: p.gcode_state,                        // ex: RUNNING
      job_state: p.job && p.job.job_state,
      subtask_name: p.subtask_name,
      job_id: p.job_id,

      // Progression
      progress: (p.percent !== undefined) ? p.percent : p.mc_percent,
      layer_num: p.layer_num,
      total_layer_num: p.total_layer_num,

      // Temps restant
      remaining_time: (p.remain_time !== undefined)
        ? p.remain_time
        : p.mc_remaining_time,

      // Fichier
      gcode_file: p.gcode_file,

      // Températures
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

      // Réseau
      wifi_signal: p.wifi_signal
    };

    // AMS: slot courant
    if (p.ams && p.ams.tray_now !== undefined && p.ams.ams && p.ams.ams.length > 0) {
      const trayNow = String(p.ams.tray_now); // "1" dans ton exemple
      const ams0 = p.ams.ams[0];
      if (ams0.tray && Array.isArray(ams0.tray)) {
        const tray = ams0.tray.find(t => String(t.id) === trayNow);
        if (tray) {
          status.ams_tray_now = tray.id;
          status.ams_tray_type = tray.tray_type;
          status.ams_tray_color = tray.tray_color;
        }
      }
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