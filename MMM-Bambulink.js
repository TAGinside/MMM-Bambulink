/* Magic Mirror
 * Module: MMM-Bambulink
 */

// Helper : convertit des minutes en "Xj Yh Zm"
function formatMinutesToDHM(minutes) {
  if (minutes === undefined || minutes === null || isNaN(minutes)) {
    return "N/A";
  }
  const total = parseInt(minutes, 10);
  const days = Math.floor(total / (24 * 60));
  const hours = Math.floor((total % (24 * 60)) / 60);
  const mins = total % 60;
  return `${days}j ${hours}h ${mins}m`;
}

// Helper : label pour le niveau de vitesse (spd_lvl)
function speedLevelLabel(level) {
  switch (parseInt(level, 10)) {
    case 1: return "Silencieux";
    case 2: return "Standard";
    case 3: return "Sport";
    case 4: return "Insensé";
    default: return "Inconnu";
  }
}

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

    // Envoyer la config au node_helper.
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
      wrapper.innerHTML = "MMM-Bambulink: configuration incomplète (ip / accessCode / serial).";
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

    // Ligne 2: progression + couches + temps restant (formaté)
    const progressLine = document.createElement("div");
    progressLine.className = "bambu-progress-line";
    const percent = (s.progress !== undefined) ? `${s.progress}%` : "N/A";
    const layers = (s.layer_num !== undefined && s.total_layer_num !== undefined)
      ? `${s.layer_num}/${s.total_layer_num}`
      : "N/A";
    const remaining = formatMinutesToDHM(s.remaining_time);
    progressLine.innerHTML = `Progression: ${percent} – Couches: ${layers} – Temps restant: ${remaining}`;
    info.appendChild(progressLine);

    // Ligne 3: vitesse impression
    if (s.speed_mag !== undefined || s.speed_level !== undefined) {
      const speedLine = document.createElement("div");
      speedLine.className = "bambu-speed-line";
      const mag = (s.speed_mag !== undefined) ? `${s.speed_mag}%` : "N/A";
      const lvlLabel = speedLevelLabel(s.speed_level);
      speedLine.innerHTML = `Vitesse: ${mag} (${lvlLabel})`;
      info.appendChild(speedLine);
    }

    // Ligne 4: températures buse / lit
    const tempLine = document.createElement("div");
    tempLine.className = "bambu-temp-line";
    const noz = (s.nozzle_temp !== undefined) ? `${s.nozzle_temp}°C` : "N/A";
    const nozTar = (s.nozzle_target !== undefined) ? `${s.nozzle_target}°C` : "N/A";
    const bed = (s.bed_temp !== undefined) ? `${s.bed_temp}°C` : "N/A";
    const bedTar = (s.bed_target !== undefined) ? `${s.bed_target}°C` : "N/A";
    tempLine.innerHTML = `Buse: ${noz} (${nozTar}) – Lit: ${bed} (${bedTar})`;
    info.appendChild(tempLine);

    // Ligne 5: température chambre
    if (s.chamber_temp !== undefined) {
      const chamberLine = document.createElement("div");
      chamberLine.className = "bambu-chamber-line";
      chamberLine.innerHTML = `Temp. chambre: ${s.chamber_temp}°C`;
      info.appendChild(chamberLine);
    }

    // Ligne 6: filament AMS + couleur + humidité AMS + température AMS
if (s.ams_tray_now !== undefined || s.ams_humidity !== undefined || s.ams_temp !== undefined) {
  const amsLine = document.createElement("div");
  amsLine.className = "bambu-ams-line";

  // Texte "Slot 1: Type de filament"
  const slotSpan = document.createElement("span");
  slotSpan.textContent = (s.ams_tray_now !== undefined)
    ? `Slot ${s.ams_tray_now}: ${s.ams_tray_type || "Inconnu"}`
    : "AMS";
  amsLine.appendChild(slotSpan);

  // Rectangle couleur "HEX" si ams_tray_color est défini
  if (s.ams_tray_color) {
    const colorBox = document.createElement("span");
    colorBox.className = "bambu-ams-color-box";
    const rgb = s.ams_tray_color.replace("#", "").substring(0, 6);

    colorBox.style.display = "inline-block";
    colorBox.style.width = "38px";      // ≈ 1 cm
    colorBox.style.height = "1.2em";    // hauteur proche de la taille du texte
    colorBox.style.margin = "0 6px";
    colorBox.style.backgroundColor = "#" + rgb;
    colorBox.style.verticalAlign = "middle";

    amsLine.appendChild(colorBox);
  }

  // AMS Humidité + température, après le rectangle
  const parts = [];
  if (s.ams_humidity !== undefined) {
    parts.push(`Humidité: ${s.ams_humidity}%`);
  }
  if (s.ams_temp !== undefined) {
    parts.push(`Temp: ${s.ams_temp}°C`);
  }

  if (parts.length > 0) {
    const detailsSpan = document.createElement("span");
    detailsSpan.textContent = " – " + parts.join(" – ");
    amsLine.appendChild(detailsSpan);
  }

  info.appendChild(amsLine);
}

    // Ligne 7: WiFi
    if (s.wifi_signal) {
      const netLine = document.createElement("div");
      netLine.className = "bambu-net-line";
      netLine.innerHTML = `WiFi: ${s.wifi_signal}`;
      info.appendChild(netLine);
    }

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