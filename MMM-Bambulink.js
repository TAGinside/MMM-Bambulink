/* Magic Mirror
 * Module: MMM-Bambulink
 */

Module.register("MMM-Bambulink", {
  // Configuration par défaut
  defaults: {
    ip: "",
    accessCode: "",
    serial: "",
    mqttPort: 8883,
    useTLS: true,
    updateInterval: 5000, // ms
    showThumbnail: true,
    thumbnailPath: "modules/MMM-Bambulink/public/printer.png"
  },

  start: function () {
    this.printerStatus = null;
    this.loaded = false;

    // Envoyer la config au node_helper (obligatoire pour qu'il l'utilise).
    this.sendSocketNotification("BAMBULINK_CONFIG", this.config);

    const self = this;
    if (this.config.updateInterval > 0) {
      setInterval(function () {
        self.sendSocketNotification("BAMBULINK_REQUEST_STATUS", {});
      }, this.config.updateInterval);
    }
  },

  getStyles: function () {
    return ["MMM-Bambulink.css"];
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-bambulink";

    if (!this.config.ip || !this.config.accessCode || !this.config.serial) {
      wrapper.innerHTML = "MMM-B ambulink: configuration incomplète (ip / accessCode / serial).";
      return wrapper;
    }

    if (!this.loaded || !this.printerStatus) {
      wrapper.innerHTML = "Bambulab: connexion en cours…";
      return wrapper;
    }

    const s = this.printerStatus;

    const container = document.createElement("div");
    container.className = "bambu-container";

    if (this.config.showThumbnail) {
      const img = document.createElement("img");
      img.className = "bambu-thumbnail";
      img.src = this.config.thumbnailPath;
      img.alt = "Bambu Lab";
      container.appendChild(img);
    }

    const info = document.createElement("div");
    info.className = "bambu-info";

    // Ligne 1: état + nom job
    const statusLine = document.createElement("div");
    statusLine.className = "bambu-status-line";
    const state = s.state || "Inconnu";
    const name = s.subtask_name || "—";
    statusLine.innerHTML = `État: ${state} – Job: ${name}`;
    info.appendChild(statusLine);

    // Ligne 2: progression + couches + temps restant
    const progressLine = document.createElement("div");
    progressLine.className = "bambu-progress-line";
    const percent = (s.progress !== undefined) ? `${s.progress}%` : "N/A";
    const layers = (s.layer_num !== undefined && s.total_layer_num !== undefined)
      ? `${s.layer_num}/${s.total_layer_num}`
      : "N/A";
    const remaining = (s.remaining_time !== undefined) ? `${s.remaining_time} min` : "N/A";
    progressLine.innerHTML = `Progression: ${percent} – Couches: ${layers} – Temps restant: ${remaining}`;
    info.appendChild(progressLine);

    // Ligne 3: températures
    const tempLine = document.createElement("div");
    tempLine.className = "bambu-temp-line";
    const noz = (s.nozzle_temp !== undefined) ? `${s.nozzle_temp}°C` : "N/A";
    const nozTar = (s.nozzle_target !== undefined) ? `${s.nozzle_target}°C` : "N/A";
    const bed = (s.bed_temp !== undefined) ? `${s.bed_temp}°C` : "N/A";
    const bedTar = (s.bed_target !== undefined) ? `${s.bed_target}°C` : "N/A";
    tempLine.innerHTML = `Buse: ${noz} (${nozTar}) – Lit: ${bed} (${bedTar})`;
    info.appendChild(tempLine);

    // Ligne 4: filament AMS
    if (s.ams_tray_now !== undefined) {
      const amsLine = document.createElement("div");
      amsLine.className = "bambu-ams-line";
      const tType = s.ams_tray_type || "Inconnu";
      const color = s.ams_tray_color || "";
      amsLine.innerHTML = `AMS Slot ${s.ams_tray_now}: ${tType} ${color}`;
      info.appendChild(amsLine);
    }

    // Ligne 5: fichier + wifi
    const fileLine = document.createElement("div");
    fileLine.className = "bambu-file-line";
    const file = s.gcode_file || "—";
    const wifi = s.wifi_signal || "N/A";
    fileLine.innerHTML = `Fichier: ${file} – WiFi: ${wifi}`;
    info.appendChild(fileLine);

    container.appendChild(info);
    wrapper.appendChild(container);

    return wrapper;
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "BAMBULINK_STATUS") {
      this.loaded = true;
      this.printerStatus = payload || {};
      this.updateDom();
    }
  }
});