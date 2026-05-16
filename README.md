# Bambulink Module for MagicMirror
Module: MMM-Bambulink

This [MagicMirror](https://github.com/MichMich/MagicMirror) module, display informations about your printer Bambulab

# Installation

Navigate into your MagicMirror's `modules` folder:
```
cd ~/MagicMirror/modules
```

Clone this repository:
```
git clone https://github.com/TAGinside/MMM-Bambulink
```

Navigate to the new `MMM-Bambulink` with:
```
cd MMM-Bambulink
```
Install the node dependencies.
```
npm install
```

Configure the module in your `config.js` file.

{
  module: "MMM-Bambulink",
  position: "top_left",
  config: {
    ip: "192.168.11.9",
    accessCode: "1f019aaf",        // ton code de connexion LAN
    serial: "01S000XXXX",          // à remplacer par le serial de ton imprimante
    mqttPort: 8883,
    useTLS: true,
    updateInterval: 5 * 1000,
    showThumbnail: true,
    thumbnailPath: "modules/MMM-Bambulink/public/printer.png"
  }
}

## Update

```sh
cd ~/MagicMirror/modules/MMM-Bambulink
git pull
npm ci
```
Restart now MagicMirror !