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
    thumbnailPath: "modules/MMM-Bambulink/public/printer.png",

    /*
     * Configuration UX/UI uniquement.
     * Aucun impact sur la logique MQTT ou sur le mapping des données.
     */
    display: {
      scale: 1,
      compact: false,
      showGraph: true,
      graphHeight: 120,
      graphMinutes: 30,
      graphLineWidth: 2,
      graphShowFill: true,
      graphShowLegend: true,
      graphShowGrid: true,
      graphShowDots: false,
      borderRadius: 14,
      contentGap: 10,
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

    /*
     * Couleurs des températures configurables.
     * Exemple demandé :
     * - rouge buse
     * - orange lit
     * - bleu chambre
     */
    temperatureColors: {
      nozzle: "#ff4d4f",
      bed: "#ff9f1a",
      chamber: "#4da3ff"
    }
  },

  start: function () {
    this.printerStatus = null;
    this.loaded = false;

    /*
     * Historique local des températures pour le graphe.
     * On reste 100% côté front, sans modifier node_helper ni MQTT.
     * Chaque point représente une capture à la réception d'un statut.
     */
    this.temperatureHistory = [];

    // Identifiant unique pour éviter toute collision si plusieurs modules sont affichés.
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
    return ["MMM-Bambulink.css"];
  },

  /*
   * Historique de température :
   * - on stocke le timestamp
   * - on conserve uniquement la fenêtre demandée en minutes
   * - aucune modification des données sources, uniquement de la mémorisation front
   */
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

  pruneTemperatureHistory: function () {
    const minutes = (this.config.display && this.config.display.graphMinutes) || 30;
    const maxAge = minutes * 60 * 1000;
    const cutoff = Date.now() - maxAge;

    this.temperatureHistory = this.temperatureHistory.filter(function (point) {
      return point.ts >= cutoff;
    });
  },

  toNumberOrNull: function (value) {
    if (value === undefined || value === null || value === "" || isNaN(value)) {
      return null;
    }
    return Number(value);
  },

  formatTemp: function (value) {
    return (value !== undefined && value !== null && !isNaN(value)) ? `${value}°C` : "N/A";
  },

  /*
   * Fabrique une carte température réutilisable.
   * On reste sur les mêmes données qu'avant, mais avec une hiérarchie visuelle claire.
   */
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

  /*
   * Dessine le graphe températures / temps dans un canvas natif.
   * Pas de dépendance externe, donc intégration simple côté MagicMirror.
   */
  drawTemperatureGraph: function (canvas) {
    if (!canvas) {
      return;
    }

    const history = this.temperatureHistory || [];
    const display = this.config.display || {};
    const colors = this.config.temperatureColors || {};

    const width = canvas.clientWidth || 420;
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
      right: 10,
      bottom: 22,
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
        allValues.push(point.value);
      });
    });

    if (!allValues.length) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = `${display.fontSizes?.graphLabel || 10}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText("Aucune donnée de température", width / 2, height / 2);
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

    // Fond du graphe
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

      for (let i = 0; i <= maxMinutes; i += 5) {
        const x = padding.left + (graphWidth * (i / maxMinutes));
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + graphHeight);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Axe Y : repères simples
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.50)";
    ctx.font = `${display.fontSizes?.graphLabel || 10}px Arial`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= 4; i++) {
      const value = minValue + ((maxValue - minValue) * (4 - i) / 4);
      const y = padding.top + (graphHeight / 4) * i;
      ctx.fillText(`${Math.round(value)}°`, padding.left - 6, y);
    }
    ctx.restore();

    // Axe X : minutes
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.50)";
    ctx.font = `${display.fontSizes?.graphLabel || 10}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let i = 0; i <= maxMinutes; i += 5) {
      const x = padding.left + (graphWidth * (i / maxMinutes));
      const label = `${maxMinutes - i}m`;
      ctx.fillText(label, x, padding.top + graphHeight + 6);
    }
    ctx.restore();

    // Séries
    const lineWidth = display.graphLineWidth || 2;
    const showFill = display.graphShowFill !== false;
    const showDots = display.graphShowDots === true;

    series.forEach((serie) => {
      if (!serie.values.length) {
        return;
      }

      ctx.save();
      ctx.strokeStyle = serie.color;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      ctx.beginPath();
      serie.values.forEach((point, index) => {
        const x = xFromTs(point.ts);
        const y = yFromValue(point.value);

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      if (showFill && serie.values.length > 1) {
        const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + graphHeight);
        gradient.addColorStop(0, this.hexToRgba(serie.color, 0.18));
        gradient.addColorStop(1, this.hexToRgba(serie.color, 0.01));

        ctx.beginPath();
        serie.values.forEach((point, index) => {
          const x = xFromTs(point.ts);
          const y = yFromValue(point.value);

          if (index === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });

        const lastX = xFromTs(serie.values[serie.values.length - 1].ts);
        const firstX = xFromTs(serie.values[0].ts);

        ctx.lineTo(lastX, padding.top + graphHeight);
        ctx.lineTo(firstX, padding.top + graphHeight);
        ctx.closePath();

        ctx.fillStyle = gradient;
        ctx.fill();
      }

      if (showDots) {
        serie.values.forEach((point) => {
          const x = xFromTs(point.ts);
          const y = yFromValue(point.value);

          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = serie.color;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.strokeStyle = this.hexToRgba(serie.color, 0.25);
          ctx.stroke();
        });
      }

      ctx.restore();
    });
  },

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

  /*
   * Hook DOM : une fois le DOM injecté par MagicMirror, on dessine le graphe.
   */
  notificationReceived: function () {
    // Intentionnellement vide.
  },

  /*
   * Après chaque updateDom, on redessine le canvas si présent.
   */
  onDomObjectsCreated: function () {
    this.renderGraphLater();
  },

  renderGraphLater: function () {
    const self = this;
    setTimeout(function () {
      const canvas = document.getElementById(`${self.instanceId}-graph`);
      if (canvas) {
        self.drawTemperatureGraph(canvas);
      }
    }, 50);
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-bambulink";

    /*
     * Variables CSS dynamiques pour piloter facilement la taille d'affichage
     * et les couleurs sans toucher au mapping de données.
     */
    const display = this.config.display || {};
    const fontSizes = display.fontSizes || {};
    const tempColors = this.config.temperatureColors || {};

    wrapper.style.setProperty("--bambu-scale", display.scale || 1);
    wrapper.style.setProperty("--bambu-base-font-size", `${fontSizes.base || 12}px`);
    wrapper.style.setProperty("--bambu-status-font-size", `${fontSizes.status || 14}px`);
    wrapper.style.setProperty("--bambu-meta-font-size", `${fontSizes.meta || 11}px`);
    wrapper.style.setProperty("--bambu-temp-value-font-size", `${fontSizes.temperatureValue || 18}px`);
    wrapper.style.setProperty("--bambu-temp-target-font-size", `${fontSizes.temperatureTarget || 11}px`);
    wrapper.style.setProperty("--bambu-graph-label-font-size", `${fontSizes.graphLabel || 10}px`);
    wrapper.style.setProperty("--bambu-radius", `${display.borderRadius || 14}px`);
    wrapper.style.setProperty("--bambu-content-gap", `${display.contentGap || 10}px`);
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

    // En-tête principal
    const header = document.createElement("div");
    header.className = "bambu-header";

    const headerMain = document.createElement("div");
    headerMain.className = "bambu-header-main";

    const state = s.state || "Inconnu";
    const name = s.subtask_name || "—";

    const statusLine = document.createElement("div");
    statusLine.className = "bambu-status-line";
    statusLine.textContent = `État: ${state}`;

    const jobLine = document.createElement("div");
    jobLine.className = "bambu-job-line";
    jobLine.textContent = `Job: ${name}`;

    headerMain.appendChild(statusLine);
    headerMain.appendChild(jobLine);

    const progressBlock = document.createElement("div");
    progressBlock.className = "bambu-progress-block";

    const percent = (s.progress !== undefined) ? `${s.progress}%` : "N/A";
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
    progressBlock.appendChild(progressValue);
    progressBlock.appendChild(progressBar);

    header.appendChild(headerMain);
    header.appendChild(progressBlock);

    // Méta infos
    const metaGrid = document.createElement("div");
    metaGrid.className = "bambu-meta-grid";

    const layers = (s.layer_num !== undefined && s.total_layer_num !== undefined)
      ? `${s.layer_num}/${s.total_layer_num}`
      : "N/A";
    const remaining = formatMinutesToDHM(s.remaining_time);

    metaGrid.appendChild(this.createMetaItem("Couches", layers));

    metaGrid.appendChild(this.createMetaItem("Temps restant", remaining));

    if (s.speed_mag !== undefined || s.speed_level !== undefined) {
      const mag = (s.speed_mag !== undefined) ? `${s.speed_mag}%` : "N/A";
      const lvlLabel = speedLevelLabel(s.speed_level);
      metaGrid.appendChild(this.createMetaItem("Vitesse", `${mag} (${lvlLabel})`));
    }

    if (s.wifi_signal) {
      metaGrid.appendChild(this.createMetaItem("WiFi", s.wifi_signal));
    }

    // Températures
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
      const amsLine = document.createElement("div");
      amsLine.className = "bambu-ams-line bambu-panel";

      const left = document.createElement("div");
      left.className = "bambu-ams-left";

      const slotSpan = document.createElement("span");
      slotSpan.textContent = (s.ams_tray_now !== undefined)
        ? `Slot ${s.ams_tray_now}: ${s.ams_tray_type || "Inconnu"}`
        : "AMS";
      left.appendChild(slotSpan);

      if (s.ams_tray_color) {
        const colorBox = document.createElement("span");
        colorBox.className = "bambu-ams-color-box";
        const rgb = s.ams_tray_color.replace("#", "").substring(0, 6);
        colorBox.style.backgroundColor = "#" + rgb;
        left.appendChild(colorBox);
      }

      const right = document.createElement("div");
      right.className = "bambu-ams-right";

      const parts = [];
      if (s.ams_humidity !== undefined) {
        parts.push(`Humidité: ${s.ams_humidity}%`);
      }
      if (s.ams_temp !== undefined) {
        parts.push(`Temp: ${s.ams_temp}°C`);
      }
      right.textContent = parts.join(" – ");

      amsLine.appendChild(left);
      amsLine.appendChild(right);

      container.appendChild(header);
      container.appendChild(metaGrid);
      container.appendChild(temperatureSection);
      container.appendChild(amsLine);
    } else {
      container.appendChild(header);
      container.appendChild(metaGrid);
      container.appendChild(temperatureSection);
    }

    // Graphe des températures
    if (display.showGraph !== false) {
      const graphPanel = document.createElement("div");
      graphPanel.className = "bambu-graph-panel";

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

    // Redessine le graphe après insertion dans le DOM.
    this.renderGraphLater();

    return wrapper;
  },

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

  socketNotificationReceived: function (notification, payload) {
    if (notification === "BAMBULINK_STATUS") {
      this.loaded = true;
      this.printerStatus = payload || {};

      // Historise les températures à chaque nouveau statut reçu.
      this.addTemperatureSnapshot(this.printerStatus);

      this.updateDom(300);
    }
  }
});