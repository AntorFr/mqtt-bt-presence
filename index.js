'use strict';

var mqtt    = require('mqtt');
var extend  = require('deep-extend');
var config  = require('./config.json');
var path    = require("path");

const NodeCache = require( "node-cache" );

var devices = {};
  
config = extend({
  broker:{
    host: 'localhost',
    username: '',
    password: '',
    clientId: 'mqtt-bt-presence', 
    port: 1883, 
    keepalive : 60
  },
  topics:{
    input: '/home/home_presence/#',
    output: 'home/BT/presence',
    learning: 'home/home_presence_learning',
    detection: 'home/BT/detection',
  },
  cache:{
    stdTTL: 120,                   //the standard ttl as number in seconds for every generated cache element. 0 = unlimited
    checkperiod: 5,               //The period in seconds, as a number, used for the automatic delete check interval. 0 = no periodic check.
    errorOnMissing: false,        //en/disable throwing or passing an error to the callback if attempting to .get a missing or expired value.
		useClones: true,              //en/disable cloning of variables. If true you'll get a copy of the cached variable. If false you'll save and get just the reference. Note: true is recommended, because it'll behave like a server-based caching. You should set false if you want to save mutable objects or other complex types with mutability involved and wanted. Here's a simple code exmaple showing the different behavior
		deleteOnExpire: true          //whether variables will be deleted automatically when they expire. If true the variable will be deleted. If false the variable will remain. You are encouraged to handle the variable upon the event expired by yourself.
  }
}, config);

const myCache = new NodeCache(config.cache);

/*
if (undefined === config.bridges || !config.bridges.length) {
  console.error('No Philips Hue bridges are configured. Please configure a bridge and try again.');
  process.exit(1);
}
*/
function slugify(value) {
  return value.toString().toLowerCase().replace(/:/g, '')
}

// Exit handling to disconnect client
function exitHandler() {
  client.end();
  process.exit();
}

// Disconnect client when script exits
process.on('exit', exitHandler);
process.on('SIGINT', exitHandler);

var client = mqtt.connect(config.broker);

client.on('connect', mqtt_connect);
client.on('reconnect', mqtt_reconnect);
client.on('error', mqtt_error);
client.on('message', mqtt_messsageReceived);
client.on('close', mqtt_error);

function mqtt_connect(){ 
  console.log("Connecting MQTT"); 
  client.subscribe(config.topics.input, mqtt_subscribe);
  client.subscribe(config.topics.learning, mqtt_subscribe);
}

function mqtt_reconnect(err){ 
  console.log("Reconnect MQTT"); 
  if (err) {
    mqtt_error(err);
    client = mqtt.connect(config.broker);
  } 
}

function mqtt_error(err) {
  if (err)
    return console.error('MQTT Error: %s', err.toString());
}

function mqtt_subscribe(err, granted){ 
  console.log("Subscribed to channels"); 
  if (err) {console.log(err);}
  }

function after_publish(){ 
  //do nothing
  }

  //home/home_presence/Garage : 
  //"{"id":"94:65:2d:c4:5b:6e","name":"INTRA-MOB09","rssi":-84,"distance":13.66931}"
  
function mqtt_messsageReceived(topic, message, packet){ 
    switch (true) {
      case (topic.includes(config.topics.learning)):
        return compute_learning_message(message)
      default:
        return compute_bt_presence(topic,message);
    }

  }

function compute_learning_message(message){
  message = JSON.parse(message);
  var device_id = slugify(message.id);

  create_device(message);

  if (message.learning_room) {
    devices[device_id].learning_room = message.learning_room;
  } else {
    devices[device_id].learning_room = undefined;
  }

}

//Create device if needed
function create_device(device){
  var exist = true;

  var device_id = slugify(device.id);
  if (!devices[device_id]) {
    devices[device_id] = {};
    devices[device_id].id = device.id;
    devices[device_id].room = {};
    exist = false;
  } 
  if(device.name){
    devices[device_id].name=device.name;
  }
  if(device.bt_type){
    devices[device_id].bt_type=device.bt_type;
  }

  return (!exist);
}

function compute_bt_presence(topic,message){
    //console.log('Topic=' + topic + ' Message=' + message);
    var dist_change = true;
    var room = path.basename(topic);

    message = JSON.parse(message);
    var device_id = slugify(message.id);
    message.room = path.basename(topic);

    if (create_device(message)) {
      publish_detection(devices[device_id],true);
    }

    if (devices[device_id].room[room]) {
      dist_change = Math.abs(message.rssi - devices[device_id].room[room].rssi) >= 3; 
    } 

    devices[device_id].room[room] = {rssi:message.rssi , distance: message.distance};
    myCache.set(device_id+"_"+room, {id:device_id,room:room});
    myCache.ttl(device_id+"_"+room);

    if(dist_change) {
      publish_device(device_id);
      }
  }

  function publish_device(device_id){
    var topic = config.topics.output + '/' + device_id;
    var payload = JSON.stringify(devices[device_id]);
    //console.log('Topic=' + topic + ' Message=' + payload);
    client.publish(topic, payload);
  }

  function publish_detection(device,status){
    var topic = config.topics.detection + '/' + slugify(device.id);
    var payload = JSON.parse(JSON.stringify(device));
    payload.room = undefined;
    payload.status = (status? 'present' : 'away');
    payload = JSON.stringify(payload);
    //console.log('Topic=' + topic + ' Message=' + payload);
    client.publish(topic, payload);
  }

  myCache.on("expired", function( key, value ){
    //console.log('delete :' +  value.id +" - " + value.room);
    delete devices[value.id].room[value.room];
    publish_device(value.id);
    if (Object.keys(devices[value.id].room).length==0) {
      publish_detection(devices[value.id],false);
      delete devices[value.id];
    }
  });