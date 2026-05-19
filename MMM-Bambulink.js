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

    // Configuration UX/UI uniquement
    display: {
      scale: 1,
      width: 320,
      compact: true,
      showGraph: true,
      graphHeight: 120,
      graphMinutes: 30,
      graphLineWidth: 2,
      graphShowFill: true,
      graphShowLegend: true,
      graphShowGrid: true,
      graphShowDots: false,
      borderRadius: 14,
      contentGap: 8,
      sectionGap: 8,
      fontSizes: {
        base: 12,
        status: 14,
        meta: 11,
        temperatureValue: 18,
        temperatureTarget: 11,
        graphLabel: 10
      }
    },

    // Couleur de chaque élément de température
    temperatureColors: {
      nozzle: "#ff4d4f",
      bed: "#ff9f1a",
      chamber: "#4da3ff"
    }
  },

  start: function () {
    this.printerStatus = null;
    this.loaded = false;

    // Historique local des températures pour le graphe
    this.temperatureHistory = [];

    // Identifiant unique par instance du module
    this.instanceId = "bambulink-" + this.identifier;

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
  return [this.file("css/MMM-Bambulink.css")];
  },

  // Convertit une valeur en nombre exploitable ou null
  toNumberOrNull: function (value) {
    if (value === undefined || value === null || value === "" || isNaN(value)) {
      return null;
    }
    return Number(value);
  },

  // Formate une température
  formatTemp: function (value) {
    return (value !== undefined && value !== null && !isNaN(value)) ? `${value}°C` : "N/A";
  },

  // Ajoute un point dans l'historique local
  addTemperatureSnapshot: function (status) {
    const now = Date.now();

    this.temperatureHistory.push({
      ts: now,
      nozzle: this.toNumberOrNull(status.nozzle_temp),
      bed: this.toNumberOrNull(status.bed_temp),
      chamber: this.toNumberOrNull(status.chamber_temp)
    });

    this.pruneTemperatureHistory();
  },

  // Garde uniquement les X dernières minutes
  pruneTemperatureHistory: function () {
    const minutes = (this.config.display && this.config.display.graphMinutes) || 30;
    const maxAge = minutes * 60 * 1000;
    const cutoff = Date.now() - maxAge;

    this.temperatureHistory = this.temperatureHistory.filter(function (point) {
      return point.ts >= cutoff;
    });

    // Garde-fou supplémentaire pour éviter un historique trop long
    if (this.temperatureHistory.length > 720) {
      this.temperatureHistory = this.temperatureHistory.slice(-720);
    }
  },

  // Crée une ligne méta d'information
  createMetaItem: function (label, value) {
    const item = document.createElement("div");
    item.className = "bambu-meta-item";

    const itemLabel = document.createElement("div");
    itemLabel.className = "bambu-meta-label";
    itemLabel.textContent = label;

    const itemValue = document.createElement("div");
    itemValue.className = "bambu-meta-value";
    itemValue.textContent = value;

    item.appendChild(itemLabel);
    item.appendChild(itemValue);

    return item;
  },

  // Crée un élément de légende pour le graphe
  createLegendItem: function (label, color) {
    const item = document.createElement("div");
    item.className = "bambu-legend-item";

    const dot = document.createElement("span");
    dot.className = "bambu-legend-dot";
    dot.style.backgroundColor = color;

    const text = document.createElement("span");
    text.className = "bambu-legend-text";
    text.textContent = label;

    item.appendChild(dot);
    item.appendChild(text);

    return item;
  },

  // Crée une carte température au format vertical
  createTemperatureCard: function (label, currentValue, targetValue, colorClass, accentColor) {
    const card = document.createElement("div");
    card.className = `bambu-temp-card ${colorClass}`;
    card.style.setProperty("--temp-accent", accentColor);

    const top = document.createElement("div");
    top.className = "bambu-temp-card-top";

    const title = document.createElement("div");
    title.className = "bambu-temp-label";
    title.textContent = label;

    const target = document.createElement("div");
    target.className = "bambu-temp-target";
    target.textContent = (targetValue !== undefined && targetValue !== null && !isNaN(targetValue))
      ? `${targetValue}°C`
      : "N/A";

    top.appendChild(title);
    top.appendChild(target);

    const value = document.createElement("div");
    value.className = "bambu-temp-value";
    value.textContent = this.formatTemp(currentValue);

    const meter = document.createElement("div");
    meter.className = "bambu-temp-meter";

    const meterFill = document.createElement("div");
    meterFill.className = "bambu-temp-meter-fill";

    let ratio = 0;
    if (
      currentValue !== undefined && currentValue !== null && !isNaN(currentValue) &&
      targetValue !== undefined && targetValue !== null && !isNaN(targetValue) &&
      Number(targetValue) > 0
    ) {
      ratio = Math.min(Number(currentValue) / Number(targetValue), 1);
    } else if (currentValue !== undefined && currentValue !== null && !isNaN(currentValue)) {
      ratio = Math.min(Number(currentValue) / 300, 1);
    }

    meterFill.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
    meter.appendChild(meterFill);

    card.appendChild(top);
    card.appendChild(value);
    card.appendChild(meter);

    return card;
  },

  // Convertit un HEX en rgba
  hexToRgba: function (hex, alpha) {
    const sanitized = String(hex || "").replace("#", "").trim();
    const full = sanitized.length === 3
      ? sanitized.split("").map(char => char + char).join("")
      : sanitized.substring(0, 6);

    const r = parseInt(full.substring(0, 2), 16) || 255;
    const g = parseInt(full.substring(2, 4), 16) || 255;
    const b = parseInt(full.substring(4, 6), 16) || 255;

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  },

  // Dessine un rectangle arrondi pour le fond du canvas
  roundRect: function (ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  },

  // Dessine le graphe des températures sur les X dernières minutes
  drawTemperatureGraph: function (canvas) {
    if (!canvas) {
      return;
    }

    const history = this.temperatureHistory || [];
    const display = this.config.display || {};
    const colors = this.config.temperatureColors || {};

    const width = Math.max(canvas.clientWidth || 0, display.width || 320);
    const height = display.graphHeight || 120;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, width, height);

    const padding = {
      top: 10,
      right: 8,
      bottom: 20,
      left: 28
    };

    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    if (graphWidth <= 0 || graphHeight <= 0) {
      return;
    }

    const now = Date.now();
    const maxMinutes = display.graphMinutes || 30;
    const minTs = now - (maxMinutes * 60 * 1000);

    const series = [
      {
        key: "nozzle",
        color: colors.nozzle || "#ff4d4f",
        values: history.filter(p => p.nozzle !== null).map(p => ({ ts: p.ts, value: p.nozzle }))
      },
      {
        key: "bed",
        color: colors.bed || "#ff9f1a",
        values: history.filter(p => p.bed !== null).map(p => ({ ts: p.ts, value: p.bed }))
      },
      {
        key: "chamber",
        color: colors.chamber || "#4da3ff",
        values: history.filter(p => p.chamber !== null).map(p => ({ ts: p.ts, value: p.chamber }))
      }
    ];

    const allValues = [];
    series.forEach(function (s) {
      s.values.forEach(function (point) {
        if (point.ts >= minTs) {
          allValues.push(point.value);
        }
      });
    });

    if (!allValues.length) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = `${display.fontSizes?.graphLabel || 10}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText("Aucune donnée", width / 2, height / 2);
      ctx.restore();
      return;
    }

    let minValue = Math.min.apply(null, allValues);
    let maxValue = Math.max.apply(null, allValues);

    minValue = Math.max(0, Math.floor(minValue - 5));
    maxValue = Math.ceil(maxValue + 5);

    if (maxValue <= minValue) {
      maxValue = minValue + 10;
    }

    const xFromTs = (ts) => {
      const ratio = (ts - minTs) / (maxMinutes * 60 * 1000);
      return padding.left + (Math.max(0, Math.min(1, ratio)) * graphWidth);
    };

    const yFromValue = (value) => {
      const ratio = (value - minValue) / (maxValue - minValue);
      return padding.top + graphHeight - (ratio * graphHeight);
    };

    // Fond léger
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    this.roundRect(ctx, 0.5, 0.5, width - 1, height - 1, 10);
    ctx.fill();
    ctx.restore();

    // Grille
    if (display.graphShowGrid !== false) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;

      for (let i = 0; i <= 4; i++) {
        const y = padding.top + (graphHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
      }

      const xStep = maxMinutes >= 20 ? 5 : 2;
      for (let i = 0; i <= maxMinutes; i += xStep) {
        const x = padding.left + (graphWidth * (i / maxMinutes));
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + graphHeight);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Repères Y
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.48)";
    ctx.font = `${display.fontSizes?.graphLabel || 10}px Arial`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= 4; i++) {
      const value = minValue + ((maxValue - minValue) * (4 - i) / 4);
      const y = padding.top + (graphHeight / 4) * i;
      ctx.fillText(`${Math.round(value)}°`, padding.left - 5, y);
    }
    ctx.restore();

    // Repères X
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.48)";
    ctx.font = `${display.fontSizes?.graphLabel || 10}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const xStep = maxMinutes >= 20 ? 5 : 2;
    for (let i = 0; i <= maxMinutes; i += xStep) {
      const x = padding.left + (graphWidth * (i / maxMinutes));
      const label = `${maxMinutes - i}m`;
      ctx.fillText(label, x, padding.top + graphHeight + 5);
    }
    ctx.restore();

    const lineWidth = display.graphLineWidth || 2;
    const showFill = display.graphShowFill !== false;
    const showDots = display.graphShowDots === true;

    series.forEach((serie) => {
      const visibleValues = serie.values.filter(point => point.ts >= minTs);

      if (!visibleValues.length) {
        return;
      }

      ctx.save();
      ctx.strokeStyle = serie.color;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      ctx.beginPath();
      visibleValues.forEach((point, index) => {
        const x = xFromTs(point.ts);
        const y = yFromValue(point.value);

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      if (showFill && visibleValues.length > 1) {
        const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + graphHeight);
        gradient.addColorStop(0, this.hexToRgba(serie.color, 0.18));
        gradient.addColorStop(1, this.hexToRgba(serie.color, 0.01));

        ctx.beginPath();
        visibleValues.forEach((point, index) => {
          const x = xFromTs(point.ts);
          const y = yFromValue(point.value);

          if (index === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });

        const lastX = xFromTs(visibleValues[visibleValues.length - 1].ts);
        const firstX = xFromTs(visibleValues[0].ts);

        ctx.lineTo(lastX, padding.top + graphHeight);
        ctx.lineTo(firstX, padding.top + graphHeight);
        ctx.closePath();

        ctx.fillStyle = gradient;
        ctx.fill();
      }

      if (showDots) {
        visibleValues.forEach((point) => {
          const x = xFromTs(point.ts);
          const y = yFromValue(point.value);

          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = serie.color;
          ctx.fill();
        });
      }

      ctx.restore();
    });
  },

  // Redessine le graphe après insertion DOM
  renderGraphLater: function () {
    const self = this;
    setTimeout(function () {
      const canvas = document.getElementById(`${self.instanceId}-graph`);
      if (canvas) {
        self.drawTemperatureGraph(canvas);
      }
    }, 60);
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-bambulink";

    const display = this.config.display || {};
    const fontSizes = display.fontSizes || {};
    const tempColors = this.config.temperatureColors || {};

    wrapper.style.setProperty("--bambu-scale", display.scale || 1);
    wrapper.style.setProperty("--bambu-width", `${display.width || 320}px`);
    wrapper.style.setProperty("--bambu-base-font-size", `${fontSizes.base || 12}px`);
    wrapper.style.setProperty("--bambu-status-font-size", `${fontSizes.status || 14}px`);
    wrapper.style.setProperty("--bambu-meta-font-size", `${fontSizes.meta || 11}px`);
    wrapper.style.setProperty("--bambu-temp-value-font-size", `${fontSizes.temperatureValue || 18}px`);
    wrapper.style.setProperty("--bambu-temp-target-font-size", `${fontSizes.temperatureTarget || 11}px`);
    wrapper.style.setProperty("--bambu-graph-label-font-size", `${fontSizes.graphLabel || 10}px`);
    wrapper.style.setProperty("--bambu-radius", `${display.borderRadius || 14}px`);
    wrapper.style.setProperty("--bambu-content-gap", `${display.contentGap || 8}px`);
    wrapper.style.setProperty("--bambu-section-gap", `${display.sectionGap || 8}px`);
    wrapper.style.setProperty("--bambu-nozzle-color", tempColors.nozzle || "#ff4d4f");
    wrapper.style.setProperty("--bambu-bed-color", tempColors.bed || "#ff9f1a");
    wrapper.style.setProperty("--bambu-chamber-color", tempColors.chamber || "#4da3ff");

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

    // En-tête vertical
    const header = document.createElement("div");
    header.className = "bambu-header bambu-panel";

    const state = s.state || "Inconnu";
    const name = s.subtask_name || "—";
    const percent = (s.progress !== undefined) ? `${s.progress}%` : "N/A";

    const statusLine = document.createElement("div");
    statusLine.className = "bambu-status-line";
    statusLine.textContent = `État: ${state}`;

    const jobLine = document.createElement("div");
    jobLine.className = "bambu-job-line";
    jobLine.textContent = `Job: ${name}`;

    const progressValue = document.createElement("div");
    progressValue.className = "bambu-progress-value";
    progressValue.textContent = percent;

    const progressBar = document.createElement("div");
    progressBar.className = "bambu-progress-bar";

    const progressBarFill = document.createElement("div");
    progressBarFill.className = "bambu-progress-bar-fill";

    let progressNumber = 0;
    if (s.progress !== undefined && !isNaN(s.progress)) {
      progressNumber = Math.max(0, Math.min(100, Number(s.progress)));
    }
    progressBarFill.style.width = `${progressNumber}%`;

    progressBar.appendChild(progressBarFill);

    header.appendChild(statusLine);
    header.appendChild(jobLine);
    header.appendChild(progressValue);
    header.appendChild(progressBar);

    // Méta infos verticales
    const metaPanel = document.createElement("div");
    metaPanel.className = "bambu-meta-panel bambu-panel";

    const layers = (s.layer_num !== undefined && s.total_layer_num !== undefined)
      ? `${s.layer_num}/${s.total_layer_num}`
      : "N/A";
    const remaining = formatMinutesToDHM(s.remaining_time);

    metaPanel.appendChild(this.createMetaItem("Couches", layers));
    metaPanel.appendChild(this.createMetaItem("Temps restant", remaining));

    if (s.speed_mag !== undefined || s.speed_level !== undefined) {
      const mag = (s.speed_mag !== undefined) ? `${s.speed_mag}%` : "N/A";
      const lvlLabel = speedLevelLabel(s.speed_level);
      metaPanel.appendChild(this.createMetaItem("Vitesse", `${mag} (${lvlLabel})`));
    }

    if (s.wifi_signal) {
      metaPanel.appendChild(this.createMetaItem("WiFi", s.wifi_signal));
    }

    // Températures en pile verticale
    const temperatureSection = document.createElement("div");
    temperatureSection.className = "bambu-temperature-section";

    temperatureSection.appendChild(
      this.createTemperatureCard(
        "Buse",
        s.nozzle_temp,
        s.nozzle_target,
        "is-nozzle",
        tempColors.nozzle || "#ff4d4f"
      )
    );

    temperatureSection.appendChild(
      this.createTemperatureCard(
        "Lit",
        s.bed_temp,
        s.bed_target,
        "is-bed",
        tempColors.bed || "#ff9f1a"
      )
    );

    if (s.chamber_temp !== undefined) {
      temperatureSection.appendChild(
        this.createTemperatureCard(
          "Chambre",
          s.chamber_temp,
          null,
          "is-chamber",
          tempColors.chamber || "#4da3ff"
        )
      );
    }

    // AMS
    if (s.ams_tray_now !== undefined || s.ams_humidity !== undefined || s.ams_temp !== undefined) {
      const amsPanel = document.createElement("div");
      amsPanel.className = "bambu-ams-line bambu-panel";

      const slotRow = document.createElement("div");
      slotRow.className = "bambu-ams-slot-row";

      const slotSpan = document.createElement("span");
      slotSpan.textContent = (s.ams_tray_now !== undefined)
        ? `Slot ${s.ams_tray_now}: ${s.ams_tray_type || "Inconnu"}`
        : "AMS";
      slotRow.appendChild(slotSpan);

      if (s.ams_tray_color) {
        const colorBox = document.createElement("span");
        colorBox.className = "bambu-ams-color-box";
        const rgb = s.ams_tray_color.replace("#", "").substring(0, 6);
        colorBox.style.backgroundColor = "#" + rgb;
        slotRow.appendChild(colorBox);
      }

      amsPanel.appendChild(slotRow);

      if (s.ams_humidity !== undefined) {
        const humidityLine = document.createElement("div");
        humidityLine.className = "bambu-ams-detail";
        humidityLine.textContent = `Humidité: ${s.ams_humidity}%`;
        amsPanel.appendChild(humidityLine);
      }

      if (s.ams_temp !== undefined) {
        const tempLine = document.createElement("div");
        tempLine.className = "bambu-ams-detail";
        tempLine.textContent = `Temp: ${s.ams_temp}°C`;
        amsPanel.appendChild(tempLine);
      }

      container.appendChild(header);
      container.appendChild(metaPanel);
      container.appendChild(temperatureSection);
      container.appendChild(amsPanel);
    } else {
      container.appendChild(header);
      container.appendChild(metaPanel);
      container.appendChild(temperatureSection);
    }

    // Graphe vertical
    if (display.showGraph !== false) {
      const graphPanel = document.createElement("div");
      graphPanel.className = "bambu-graph-panel bambu-panel";

      if (display.graphShowLegend !== false) {
        const legend = document.createElement("div");
        legend.className = "bambu-graph-legend";

        legend.appendChild(this.createLegendItem("Buse", tempColors.nozzle || "#ff4d4f"));
        legend.appendChild(this.createLegendItem("Lit", tempColors.bed || "#ff9f1a"));

        if (s.chamber_temp !== undefined) {
          legend.appendChild(this.createLegendItem("Chambre", tempColors.chamber || "#4da3ff"));
        }

        graphPanel.appendChild(legend);
      }

      const graphCanvas = document.createElement("canvas");
      graphCanvas.id = `${this.instanceId}-graph`;
      graphCanvas.className = "bambu-graph-canvas";
      graphCanvas.height = display.graphHeight || 120;

      graphPanel.appendChild(graphCanvas);
      container.appendChild(graphPanel);
    }

    wrapper.appendChild(container);

    this.renderGraphLater();

    return wrapper;
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "BAMBULINK_STATUS") {
      this.loaded = true;
      this.printerStatus = payload || {};

      // Historise les températures pour alimenter le graphe
      this.addTemperatureSnapshot(this.printerStatus);

      this.updateDom(300);
    }
  }
});