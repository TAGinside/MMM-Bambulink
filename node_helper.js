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
      // Rien à faire: l'imprimante envoie déjà ses statuts en continu via MQTT.
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
      username: "bblp",
      password: this.config.accessCode,
      rejectUnauthorized: false
    };

    this.log(`Connexion MQTT à ${url}`);
    this.client = mqtt.connect(url, options);

    const self = this;

    this.client.on("connect", function () {
      self.log("Connecté au broker MQTT Bambu");

      const topic = `device/${self.config.serial}/report`;
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

      // Température chambre
      chamber_temp: undefined,

      // Réseau
      wifi_signal: p.wifi_signal
    };

    // AMS: slot courant + humidité + température AMS
    if (p.ams && p.ams.tray_now !== undefined && p.ams.ams && p.ams.ams.length > 0) {
      const trayNow = String(p.ams.tray_now);
      const ams0 = p.ams.ams[0];

      if (ams0.humidity_raw !== undefined) {
        status.ams_humidity = ams0.humidity_raw;
      }
      if (ams0.temp !== undefined) {
        status.ams_temp = ams0.temp;
      }

      if (ams0.tray && Array.isArray(ams0.tray)) {
        const tray = ams0.tray.find(t => String(t.id) === trayNow);
        if (tray) {
          status.ams_tray_now = tray.id;
          status.ams_tray_type = tray.tray_type;
          status.ams_tray_color = tray.tray_color;
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