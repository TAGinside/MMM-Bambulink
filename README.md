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


## Using the module

To use this module, add it to the modules array in the `config/config.js` file. 


```javascript
modules: [
  {
  module: "MMM-Bambulink",
  position: "top_left",
  config: {
    ip: "x.x.x.x",                 // IP address of the printer
    accessCode: "xxxxxxxx",        // LAN Connection Code
    serial: "XXXXXXXXXXXXXXX",     // Serial number of the printer
    mqttPort: 8883,
    useTLS: true,
    updateInterval: 5000,          // ms
    showThumbnail: true ,
    thumbnailPath: "modules/MMM-Bambulink/thumbnails/H2S.png",
    }
  },
]
```

## Update

```sh
cd ~/MagicMirror/modules/MMM-Bambulink
git pull
npm ci
```
Restart now MagicMirror !