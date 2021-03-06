"use strict";

var self = module.exports = {
    connecting: false,

    init: function() {
        console.log("Initializing Harmony Hub app...");
        self.listenForTriggers();
        console.log("Initializing Harmony Hub app completed.");
    },

    /**
     * Starts listening for specific triggers and sends them to the requested Harmony Hub.
     * 
     * @returns {} 
     */
    listenForTriggers: function() {

        Array.prototype.sortBy = function(p) {
            return this.slice(0)
                .sort(function(a, b) {
                    return (a[p] > b[p]) ? 1 : (a[p] < b[p]) ? -1 : 0;
                });
        }

        Homey.manager("flow")
            .on("action.start_activity.activity.autocomplete",
                function(callback, args) {
                    Homey.manager("drivers").getDriver("hub").autocompleteActivity(args, callback);
                });

        Homey.manager("flow")
            .on("action.send_command_to_device.device.autocomplete",
                function(callback, args) {
                    Homey.manager("drivers").getDriver("hub").autocompleteDevice(args, callback);
                });

        Homey.manager("flow")
            .on("action.send_command_to_device.controlGroup.autocomplete",
                function(callback, args) {
                    //Homey.log(JSON.stringify(args));
                    if (args.args.device.length === 0) {
                        callback(null, []);
                        return;
                    }
					
                    var listOfControlGroups = [];					
					for(var key in args.args.device.commands)
					{
						console.log("finding element at key: "+key);
						console.log(args.args.device.commands[key]);
						if (args.query.length === 0 || args.args.device.commands[key].name.toUpperCase().indexOf(args.query.toUpperCase()) !== -1) {
							listOfControlGroups.push(args.args.device.commands[key]);
                        }
					}

                    callback(null, listOfControlGroups.sortBy("name"));
                });

        Homey.manager("flow")
            .on("action.start_activity",
                function(callback, args) {
                    Homey.manager("drivers").getDriver("hub").startActivity(args, callback);
                });

        Homey.manager("flow")
            .on("action.send_command_to_device",
                function(callback, args) {
                    Homey.manager("drivers").getDriver("hub").sendCommandToDevice(args, callback);
                });

        Homey.manager("flow")
            .on("action.all_off",
                function(callback, args) {
                    Homey.manager("drivers").getDriver("hub").allOff(args, callback);
                });

        console.log("Listening for triggers...");
    },

    updateSettings: function(settings, callback) {
        // Update settings.
        Homey.manager("settings").set("reconnect_interval", parseInt(settings.reconnectIntervalInSeconds));
        Homey.manager("settings").set("enable_speech", settings.enableSpeech);
        console.log("Settings updated: " + JSON.stringify(settings));

        // Return success
        if (callback) callback(null, true);
    }
};