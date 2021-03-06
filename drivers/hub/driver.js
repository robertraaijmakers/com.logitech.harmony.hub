﻿"use strict";
var fs = require('fs')
var path = require('path')
var util = require('util')
var express = require('express')
var morgan = require('morgan')
var bodyParser = require('body-parser')
var parameterize = require('parameterize')

var harmonyHubDiscover = require('harmonyhubjs-discover')
var harmony = require('harmonyhubjs-client')

var harmonyHubClients = {}
var harmonyActivitiesCache = {}
var harmonyActivityUpdateInterval = 5*60*1000 // 5 minutes
var harmonyActivityUpdateTimers = {}

var harmonyHubStates = {}
var harmonyStateUpdateInterval = 5*1000 // 5 seconds
var harmonyStateUpdateTimers = {}

var harmonyDevicesCache = {}
var harmonyDeviceUpdateInterval = 5*60*1000 // 5 minutes
var harmonyDeviceUpdateTimers = {}

var HomeyRegisteredDevices = {};
var HomeyActiveDevices = {};

/**
* Initialise hub discovery events
**/
var discover = new harmonyHubDiscover(61991)
	discover.on('online', function(hubInfo) {
	  // Triggered when a new hub was found
	  console.log('Hub discovered: ' + hubInfo.friendlyName + ' at ' + hubInfo.ip + ' with id ' + parameterize(hubInfo.uuid) + '.')

	  if (hubInfo.ip) {
		console.log("Hub has IP, try to create harmony client");
		harmony(hubInfo.ip).then(function(client) {
		  startProcessing(parameterize(hubInfo.uuid), client, hubInfo)
		})
	  }
	})

	discover.on('offline', function(hubInfo) {
	  // Triggered when a hub disappeared
	  console.log('Hub lost: ' + hubInfo.uuid + ' at ' + hubInfo.ip + '.');
	  if (!hubInfo.uuid) { return }
	  var hubSlug = parameterize(hubInfo.uuid);
	  
	  stopProcessing(hubSlug);
	});

/**
* Helper functions
*/
function startProcessing(hubSlug, harmonyClient, hubInfo){
	
	harmonyClient.hubInfo = hubInfo;
	
	harmonyClient._xmppClient.on("error",
		function (e) {
			LogError("Client for hub " + device_data.id + " reported an error: ", e);
			// Disconnect, and re-connect!
			stopProcessing(hubSlug);
		});

	harmonyClient._xmppClient.on("offline",
		function () {
			// We need to re-establish a connection...
			stopProcessing(hubSlug);
		});

	harmonyClient.on("stateDigest",
		function(stateDigest) {
			HandleStateChange(stateDigest, hubSlug);
		});
		
	if(typeof harmonyClient._xmppClient.connection !== 'undefined')
	{
		if(typeof harmonyClient._xmppClient.connection.connected !== 'undefined')
		{
			console.log("Is connected");
			Log(harmonyClient._xmppClient.connection.connected);
		}
	}
	
  harmonyHubClients[hubSlug] = harmonyClient
  
  // Check if hub is a known Homey device
  console.log("Start processing");

  // update the list of activities
  updateActivities(hubSlug)
  // then do it on the set interval
  clearInterval(harmonyActivityUpdateTimers[hubSlug])
  harmonyActivityUpdateTimers[hubSlug] = setInterval(function(){ updateActivities(hubSlug) }, harmonyActivityUpdateInterval)

  // update the state
  updateState(hubSlug)
  // update the list of activities on the set interval
  clearInterval(harmonyStateUpdateTimers[hubSlug])
  //harmonyStateUpdateTimers[hubSlug] = setInterval(function(){ updateState(hubSlug) }, harmonyStateUpdateInterval)

  // update devices
  updateDevices(hubSlug)
  // update the list of devices on the set interval
  clearInterval(harmonyDeviceUpdateTimers[hubSlug])
  harmonyDeviceUpdateTimers[hubSlug] = setInterval(function(){ updateDevices(hubSlug) }, harmonyDeviceUpdateInterval)
}

function stopProcessing(hubSlug)
{
	clearInterval(harmonyStateUpdateTimers[hubSlug])
	clearInterval(harmonyActivityUpdateTimers[hubSlug])
	delete(harmonyHubClients[hubSlug])
	delete(harmonyActivitiesCache[hubSlug])
	delete(harmonyHubStates[hubSlug])
}

function updateActivities(hubSlug){
  var harmonyHubClient = harmonyHubClients[hubSlug]

  if (!harmonyHubClient) { return }
  console.log('Updating activities for ' + hubSlug + '.')

  try {
    harmonyHubClient.getActivities().then(function(activities){
      var foundActivities = {}
      activities.forEach(function(activity) {

        foundActivities[activity.id] = {id: activity.id, slug: parameterize(activity.label), label: activity.label, isAVActivity: activity.isAVActivity, icon: activity.baseImageUri + activity.imageKey }
        Object.defineProperty(foundActivities[activity.id], "commands", {
          enumerable: false,
          writeable: true,
          value: getCommandsFromControlGroup(activity.controlGroup)
        });
      });
	  
      harmonyActivitiesCache[hubSlug] = foundActivities
    })
  } catch(err) {
    console.log("ERROR: " + err.message);
  }
}

function updateState(hubSlug){
  var harmonyHubClient = harmonyHubClients[hubSlug]

  if (!harmonyHubClient) { return }
  console.log('Updating state for ' + hubSlug + '.')

  // save for comparing later after we get the true current state
  var previousActivity = currentActivity(hubSlug)

  try {
    harmonyHubClient.getCurrentActivity().then(function(activityId){
      var data = {off: true}

      var activity = harmonyActivitiesCache[hubSlug][activityId]
      var commands = Object.keys(activity.commands).map(function(commandSlug){
        return activity.commands[commandSlug]
      })

      if (activityId != -1 && activity) {
        data = {off: false, current_activity: activity, activity_commands: commands}
      }else{
        data = {off: true, current_activity: activity, activity_commands: commands}
      }

      // cache state for later
      harmonyHubStates[hubSlug] = data
    })
  } catch(err) {
    console.log("ERROR: " + err.message);
  }
}

function updateDevices(hubSlug){
  var harmonyHubClient = harmonyHubClients[hubSlug]

  if (!harmonyHubClient) { return }
  console.log('Updating devices for ' + hubSlug + '.')
  try {
    harmonyHubClient.getAvailableCommands().then(function(commands) {
      var foundDevices = {}
      commands.device.forEach(function(device) {
        var deviceCommands = getCommandsFromControlGroup(device.controlGroup)
		
        foundDevices[device.id] = {
				id: device.id, 
				slug: parameterize(device.label), 
				label:device.label, 
				name: device.label, 
				description: device.model,
				commands: deviceCommands
		}
      })

      harmonyDevicesCache[hubSlug] = foundDevices
    })

  } catch(err) {
    console.log("Devices ERROR: " + err.message);
  }
}

function getCommandsFromControlGroup(controlGroup){
  var deviceCommands = {}
  controlGroup.forEach(function(group) {
    group.function.forEach(function(func) {
      var slug = parameterize(func.label) + '';
      deviceCommands[slug] = { name: func.name, slug: slug, label: func.label, action: func.action.replace(/\:/g, '::') }
    })
  })
  return deviceCommands
}

function cachedHarmonyActivities(hubSlug){
  var activities = harmonyActivitiesCache[hubSlug]
  if (!activities) { return [] }

  return Object.keys(harmonyActivitiesCache[hubSlug]).map(function(key) {
    return harmonyActivitiesCache[hubSlug][key]
  })
}

function currentActivity(hubSlug){
  var harmonyHubClient = harmonyHubClients[hubSlug]
  var harmonyHubState = harmonyHubStates[hubSlug]
  if (!harmonyHubClient || !harmonyHubState) { return null}

  return harmonyHubState.current_activity
}

function activityBySlugs(hubSlug, activitySlug){
  var activity
  cachedHarmonyActivities(hubSlug).some(function(a) {
    if(a.slug === activitySlug) {
      activity = a
      return true
    }
  })

  return activity
}

function activityCommandsBySlugs(hubSlug, activitySlug){
  var activity = activityBySlugs(hubSlug, activitySlug)

  if (activity) {
    return Object.keys(activity.commands).map(function(commandSlug){
      return activity.commands[commandSlug]
    })
  }
}

function cachedHarmonyDevices(hubSlug){
  var devices = harmonyDevicesCache[hubSlug]
  if (!devices) { return [] }

  return Object.keys(harmonyDevicesCache[hubSlug]).map(function(key) {
    return harmonyDevicesCache[hubSlug][key]
  })
}

function off(hubSlug){
  var harmonyHubClient = harmonyHubClients[hubSlug]
  if (!harmonyHubClient) { return }

  harmonyHubClient.turnOff().then(function(){
    updateState(hubSlug)
  })
}

function startActivity(hubSlug, activityId){
  var harmonyHubClient = harmonyHubClients[hubSlug]
  if (!harmonyHubClient) { return }

  harmonyHubClient.startActivity(activityId).then(function(){
    updateState(hubSlug)
  })
}

function sendAction(hubSlug, deviceSlug, actionSlug, repeat){
  var repeat = Number.parseInt(repeat) || 1;
  var harmonyHubClient = harmonyHubClients[hubSlug];
  if (!harmonyHubClient) { return }

  // Retrieve device
  var devices = cachedHarmonyDevices(hubSlug);
  
  var curDevice = null;
  devices.forEach(function(device) {
		if (device.slug === deviceSlug) {
			curDevice = device;
		}
	});
	
  if(curDevice === null)
  {
	  console.log("No matching device found for " + deviceSlug);
	  return;
  }
  
  // Retrieve action
  var action = curDevice.commands[actionSlug];
  console.log(action);
  
  console.log("Sending actual command");
  
  var pressAction = 'action=' + action.action + ':status=press:timestamp=0';
  var releaseAction =  'action=' + action.action + ':status=release:timestamp=55';
  for (var i = 0; i < repeat; i++) {
    harmonyHubClient.send('holdAction', pressAction).then(function (){
       harmonyHubClient.send('holdAction', releaseAction)
    })
  }
}

module.exports.init = function(devices_data, callback) {
    // ATHOM: When the driver starts, Homey rebooted. Initialize all previously paired devices.
    Log("Previously paired " + devices_data.length + " hub(s).");
	
	// Start discovery
	discover.start();
	
	if (devices_data.length > 0) {
		devices_data.forEach(function(device_data) {
            // ATHOM: Do something here to initialise the device, e.g. start a socket connection.
            Log("Finding previously paired hub with id: " + device_data.id);
			InitDevice(device_data);
		});
	}

    // ATHOM: Let Homey know the driver is ready.
    if (callback) callback();
}

/**
* Homney Pair Functions
*/ 
module.exports.added = function(device_data, callback) {
    // ATHOM: run when a device has been added by the user (as of v0.8.33)
    InitDevice(device_data);
    callback(null, true);
}

module.exports.renamed = function(device_data, new_name) {
    // ATHOM: run when the user has renamed the device in Homey.
    // It is recommended to synchronize a device's name, so the user is not confused
    // when it uses another remote to control that device (e.g. the manufacturer's app).
}

module.exports.deleted = function(device_data, callback) {
    delete(HomeyRegisteredDevices[device_data.id]);
    callback(null, true);
}

module.exports.settings = function(device_data, newSettingsObj, oldSettingsObj, changedKeysArr, callback) {
    // ATHOM: see settings
}

module.exports.pair = function(socket) {
    // `socket` is a direct channel to the front-end
    // Note: objects will be JSON stringified, so don't use special object such as Error or Buffer.

    // this method is run when Homey.emit('start') is run on the front-end
    socket.on('start',
        function(data, callback) {
            Log("Pairing started...");
            callback(null, 'Started!');
        });

    // this method is run when Homey.emit('list_devices') is run on the front-end
    // which happens when you use the template `list_devices`
    socket.on("list_devices",
        function(data, callback) {
			var listOfDevices = [];
			for(var client in harmonyHubClients)
			{
				console.log("Identified client");
				if(typeof HomeyRegisteredDevices[client] === 'undefined')
				{
					console.log("Adding hub");
					listOfDevices.push(MapHubToDeviceData(client, harmonyHubClients[client]));
				}
			}

			// err, result style
			callback(null, listOfDevices);
        });

    // ATHOM: User aborted pairing, or pairing is finished.
    socket.on("disconnect",
        function() {
            Log("User aborted pairing, or pairing is finished");
        });
}

module.exports.capabilities = {
    activity: {
        // ATHOM: this function is called by Homey when it wants to GET the current activity, e.g. when the user loads the smartphone interface.
        // `device_data` is the object as saved during pairing.
        // `callback` should return the current value in the format callback( err, value ).
        get: function(device_data, callback) {
            // ATHOM: get the hub with a locally defined function.
            var device = GetHubByData(device_data);
            if (device instanceof Error) return callback(device);

            // ATHOM: send the current activity to Homey.
            callback(null, device.activity.name);
        },

        // ATHOM: this function is called by Homey when it wants to SET the current activity, e.g. when the user says 'watch tv'.
        // `device_data` is the object as saved during pairing.
        // `activity` is the new value.
        // `callback` should return the new value in the format callback( err, value ).
        set: function(device_data, activity, callback) {
            var device = GetHubByData(device_data);
            if (device instanceof Error) return callback(device);

            // TODO: Get the current hub activity.
            var curActivity = null;

            // ATHOM: Set the new activity, only when if differs from the current.
            if (curActivity !== activity) {
                // TODO: Set the new activity here.
                module.exports.realtime(device_data, 'activity', activity);
                updateHub(device_data.id);
            }

            // TODO: Refresh the current hub activity.
            curActivity = null;

            // ATHOM: send the new activity value to Homey.
            callback(null, curActivity);
        }
    }
}

/**
* Autocomplete functions
*/
module.exports.autocompleteActivity = function(args, callback) {
    if (args.query.length > 0) {
        Log("Finding activity '" + args.query + "' on " + args.args.hub.ip + "...");
    } else {
        Log("Finding activities on " + args.args.hub.ip + "...");
    }

	var activities = cachedHarmonyActivities(args.args.hub.id);

	if(typeof activities !== 'undefined' && activities.length > 0)
	{
		var hubActivities = [];
		activities.forEach(function(activity) {
			if (activity.isAVActivity && (args.query.length === 0 || activity.label.toUpperCase().indexOf(args.query.toUpperCase()) !== -1)) {
				var outputActivity = {};
				outputActivity.name = activity.label;
				outputActivity.icon = activity.icon;
				outputActivity.hub = args.args.hub;
				outputActivity.id = activity.id;				
				hubActivities.push(outputActivity);
			}
		});
		
		callback(null, hubActivities);
		return;
	}
	else
	{
		console.log("Getting activities, unlikely that activities list should be empty.");
		updateActivities(args.args.hub.id);
	}
	
	callback(null, []);
};

module.exports.autocompleteDevice = function(args, callback) {
    if (args.query.length > 0) {
        Log("Finding device '" + args.query + "' on " + args.args.hub.id + "...");
    } else {
        Log("Finding device on " + args.args.hub.ip + "...");
    }

	var devices = cachedHarmonyDevices(args.args.hub.id);	
	if(typeof devices !== 'undefined' && devices.length > 0)
	{
		var hubDevices = [];
		devices.forEach(function(device) {
			if ((args.query.length === 0 || device.label.toUpperCase().indexOf(args.query.toUpperCase()) !== -1)) {
				hubDevices.push(device);
			}
		});
		
		callback(null, hubDevices);
		return;
	}	
	callback(null, []);
};

/*
* Action cards
*/
module.exports.startActivity = function (args, callback) {
	var hubSlug = parameterize(args.hub.id);
	var curActivity = currentActivity(hubSlug);
	
	if(typeof curActivity === 'undefined' || typeof curActivity.id === 'undefined')
	{
		Log("Starting activity '" + args.activity.name + "' on " + args.hub.ip + "...");
		startActivity(hubSlug, args.activity.id);
		callback(null, true);
		return;
	}
	else if(curActivity.id !== args.activity.id)
	{
		Log("Switching activity to '" + args.activity.name + "' on " + args.hub.ip + "...");
		startActivity(hubSlug, args.activity.id);
		callback(null, true);
		return;
	}
	
	Log("Not starting activity '" + args.activity.name + "' on " + args.hub.ip + "...");
	callback(null, false);
};

module.exports.sendCommandToDevice = function (args, callback) {
    Log("Sending action to " + args.hub.ip + "...");	
	sendAction(args.hub.id, args.device.slug, args.controlGroup.slug, 1);
	callback(null, true);
};

module.exports.allOff = function(args, callback) {
    Log("Turning all devices off on " + args.hub.ip + "...");

	off(args.hub.id);
	callback(null, true);
};

/**
 * ATHOM: a helper method to add a device to the devices list.
 * 
 * @param {} device_data
 */
function InitDevice(device_data, callback) {
    Log("Initializing device...");
    Log(JSON.stringify(device_data));

    // Add hub to list of devices.
    HomeyRegisteredDevices[device_data.id] = {};
    HomeyRegisteredDevices[device_data.id].data = device_data;
}

/**
 * Maps hub details to device_data object.
 * 
 * @param {} hub
 * @returns {} device_data
 */
function MapHubToDeviceData(hubSlug, hub) {
	
	Log(hubSlug);
	Log(hub);
	
    return {
        name: hub.hubInfo.friendlyName,
        data: {
            // this data object is saved to- and unique for the device. It is passed on the get and set functions as 1st argument
            id: hubSlug, // something unique, so your driver knows which physical device it is. A MAC address or Node ID, for example. This is required
            name: hub.hubInfo.host_name,
            friendlyName: hub.hubInfo.friendlyName,
            ip: hub.hubInfo.ip
        }
    };
}

/**
 * ATHOM: a helper method to get a device from the devices list by it's device_data object.
 * 
 * @param {} device_data
 */
function GetHubByData(device_data) {
    var device = HomeyRegisteredDevices[device_data.id];
    if (typeof device === 'undefined') {
        return new Error("invalid_device");
    } else {
        return device;
    }
}

/**
 * Handles a state digest by raising appropriate events.
 * 
 * @param {} stateDigest
 * @param {} device_data
 */
function HandleStateChange(stateDigest, hubSlug) {
	
	console.log(stateDigest);
	console.log(hubSlug);
	
	var deviceData = HomeyRegisteredDevices[hubSlug];
	if(typeof deviceData === 'undefined')
	{
		console.log("This device is not monitored by Homey");
		return;
	}
	
	console.log("State changed, handling state change");
	var curActivity = currentActivity(hubSlug);
	var stateActivity = harmonyActivitiesCache[hubSlug][stateDigest.activityId];
	
	console.log("Current activity: ");
	console.log(curActivity);
	console.log("State activity: ");
	console.log(stateActivity);

    switch (stateDigest.activityStatus) {
		case 0:
			if (stateDigest.runningActivityList.length === 0) {
				Homey.manager("flow").trigger("all_turned_off", { hub_name: deviceData.data.name });
				Homey.manager('flow').triggerDevice('all_turned_off_device', { }, { }, deviceData.data, function(err, result) {
								if( err ){ console.log(err); return Homey.error(err); }
							});
				
				// Set activity as current activity
				updateState(hubSlug);
							
				Log("Activity: Stopped.");
			} else {
				Homey.manager("flow").trigger("activity_stopping", { hub_name: deviceData.data.name, activity: stateActivity.label });
				Homey.manager('flow').triggerDevice('activity_stopping_device', { activity: stateActivity.label }, { }, deviceData.data, function(err, result) {
					if( err ){ console.log(err); return Homey.error(err); }
				});
				
				Log("Activity '" + stateActivity.label + "' (" + stateDigest.runningActivityList + "): Stopping...");
			}
			break;
		case 1:
			Homey.manager("flow").trigger("activity_start_requested", { hub_name: deviceData.data.name, activity: stateActivity.label });
			Homey.manager('flow').triggerDevice('activity_start_requested_device', { activity: stateActivity.label }, { }, deviceData.data, function(err, result) {
								if( err ){ console.log(err); return Homey.error(err); }
							});
			Log("Activity '" + stateActivity.label + "' (" + stateDigest.activityId + "): Start requested.");
			break;
		case 2:
			if (stateDigest.activityId === stateDigest.runningActivityList) {
				Homey.manager("flow").trigger("activity_started", { hub_name: deviceData.data.name, activity: stateActivity.label });
				Homey.manager('flow').triggerDevice('activity_started_device', { activity: stateActivity.label }, { }, deviceData.data, function(err, result) {
								if( err ){ console.log(err); return Homey.error(err); }
							});
				Log("Activity '" + stateActivity.label + "' (" + stateDigest.runningActivityList + "): Started.");
				
				// Set activity as current activity
				updateState(hubSlug);
			} else {
				Homey.manager("flow").trigger("activity_starting", { hub_name: deviceData.data.name, activity: stateActivity.label });
				Homey.manager('flow').triggerDevice('activity_starting_device', { activity: stateActivity.label }, { }, deviceData.data, function(err, result) {
								if( err ){ console.log(err); return Homey.error(err); }
							});
			}
			break;
		case 3:
			Homey.manager("flow").trigger("activity_stop_requested", { hub_name: deviceData.data.name, activity: stateActivity.label });
			Homey.manager('flow').triggerDevice('activity_stop_requested_device', { activity: stateActivity.label }, { }, deviceData.data, function(err, result) {
								if( err ){ console.log(err); return Homey.error(err); }
							});
			Log("Activity '" + stateActivity.label + "' (" + stateDigest.runningActivityList + "): Stop requested.");
			break;
		default:
			Log("ATTENTION: Unhandled state digest:");
			Log(JSON.stringify(stateDigest));
			break;
    }
}

/**
 * Logs the given message (to the console and by voice, if enabled).
 * 
 * @param message
 */
function LogError(message) {
    var enableSpeech = Homey.manager("settings").get("enable_speech") || false;
    if (enableSpeech) {
        Homey.manager("speech-output").say(message);
    }

    Log(message);
}

/**
 * Logs the given message (to the console).
 * 
 * @param message
 */
function Log(message) {
    Homey.log(message);
}

Array.prototype.sortBy = function (p) {
    return this.slice(0).sort(function (a, b) {
        return (a[p] > b[p]) ? 1 : (a[p] < b[p]) ? -1 : 0;
    });
}