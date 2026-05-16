# Bambulink Module for MagicMirror
Module: MMM-Bambulink

This [MagicMirror](https://github.com/MichMich/MagicMirror) module,

MMM-Bambulink is a third-party module for MagicMirror² designed to display information about your Bambu Lab printer directly on your MagicMirror screen. The module connects to your printer over the local network using Bambu Lab’s LAN credentials and updates information automatically at a configurable interval. 

**NOT NEED ONLY LAN MODE**

![Example.png](/thumbnails/) 

## Key Requirements
To use this module, you need:

* The IP address of your Bambu Lab printer (for local discovery/communication)
* The LAN connection code (access code) for your printer
* The serial number of your printer

These three values are required in the configuration to establish the connection to your printer.

## Key Features

* Monitor your Bambu Lab printer directly from MagicMirror²
* Secure LAN connection via MQTT/TLS on port 8883
* Configurable refresh interval for real-time updates
* Simple installation within the standard MagicMirror module structure
* Optional thumbnail display for the current print
* Customizable thumbnail path for printer-specific previews

## Development Status
The module is functional and ready for use in a standard MagicMirror² environment, with installation steps, Node.js dependencies, and an update procedure clearly documented in the README. Actually UX is in construction.

The current README is concise and focuses on core setup; detailed feature listings, supported printer states, error handling, and advanced views are not yet fully documented, suggesting the project is still evolving.

## Compatibility
MMM-Bambulink is designed for MagicMirror², as installation requires cloning into ~/MagicMirror/modules and adding configuration to config/config.js.

The required parameters (ip, accessCode, serial, mqttPort, useTLS) indicate it targets Bambu Lab printers with LAN mode enabled and MQTT access over a secure tunnel.

# Installation
Navigate into your MagicMirror’s modules folder:
```
cd ~/MagicMirror/modules
```
Clone the repository:
```
git clone https://github.com/TAGinside/MMM-Bambulink
```
Navigate into the new MMM-Bambulink folder:

```
cd MMM-Bambulink
```
Install the Node dependencies:

```
npm install
```
# Configuration
Add the module to the modules array in your config/config.js:

```
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
      updateInterval: 5000,          // Refresh interval in ms
      showThumbnail: true,
      thumbnailPath: "modules/MMM-Bambulink/thumbnails/H2S.png",
    }
  },
]
```
## How to Use the Module
To use this module, add it to the modules array in your config/config.js file as shown above, then restart MagicMirror.

Once running, the module will display Bambu Lab printer information in the chosen position (e.g., top_left) on your MagicMirror.

# Update
```
cd ~/MagicMirror/modules/MMM-Bambulink
git pull
npm ci
```
After updating, restart MagicMirror.

Use Cases
This module is particularly useful in a workshop, technical office, or home lab where a MagicMirror already serves as a central dashboard.

With this display, you can quickly monitor a print in progress, verify that the printer is responsive, or keep a visual overview of the current job without constantly opening Bambu Studio.

About
MMM-Bambulink brings Bambu Lab printer monitoring directly to your smart mirror, allowing you to integrate 3D print status into a broader home automation or workshop dashboard.

This module is open source and free to use and modify. For more information, updates, or to contribute, visit the GitHub repository:
https://github.com/TAGinside/MMM-Bambulink

If you try this module, let me know if it works with your printer and MagicMirror setup. Feedback and suggestions are welcome to help shape its future

# UX IN CONSTRUCTION
