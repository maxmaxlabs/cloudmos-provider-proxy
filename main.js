const fetch = require("node-fetch");
const https = require("https");
const WebSocket = require("ws");
const winston = require("winston");

let openSocket = [];

const logger = winston.createLogger({
  level: "info",
  format: winston.format.simple(),
  transports: [new winston.transports.File({ filename: "provider-proxy.log" })],
});

logger.info("Start");

process.on("uncaughtException", (error) => {
  logger.error(error);
});

process.on("message", async (message) => {
  logger.info("Received message from parent process: ", {
    ...message,
    certPem: "***REDACTED***",
    keyPem: "***REDACTED***",
  });

  try {
    if (message.type === "fetch") {
      const response = await makeProviderRequest(
        message.url,
        message.method,
        message.body,
        message.certPem,
        message.keyPem
      );
      logger.info("Sending response: ", response);
      process.send({
        id: message.id,
        type: "fetch",
        response: response,
      });
    } else if (message.type === "websocket") {
      providerWebSocket(
        message.id,
        message.url,
        message.certPem,
        message.keyPem,
        (socketMessage) => {
          if (socketMessage) {
            logger.info("Sending message: " + socketMessage);
            process.send({
              id: message.id,
              type: "websocket",
              message: socketMessage,
            });
          }
        },
        (error) => {
          logger.error(error);
        }
      );
    } else if (message.type === "websocket_close") {
      logger.info("Closing socket: " + message.id);
      openSocket[message.id].terminate();
      delete openSocket[message.id];
    } else {
      throw "Invalid message type: " + message.type;
    }
  } catch (err) {
    logger.info("Sending error: " + err);
    process.send({
      id: message.id,
      error: err.message || err,
      type: message.type,
    });
  }
});

async function makeProviderRequest(url, method, body, certPem, keyPem) {
  try {
    var myHeaders = new fetch.Headers();
    myHeaders.append("Content-Type", "application/json");

    const httpsAgent = new https.Agent({
      cert: certPem,
      key: keyPem,
      rejectUnauthorized: false,
    });

    const response = await fetch(url, {
      method: method,
      body: body,
      headers: myHeaders,
      agent: httpsAgent,
    });

    if (response.status === 200) {
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        return await response.json();
      } else {
        return await response.text();
      }
    } else {
      const res = await response.text();
      throw new Error(
        "Status code was not success (" + response.status + ") : " + res
      );
    }
  } catch (err) {
    logger.info(err);
    throw err;
  }
}

function providerWebSocket(id, url, certPem, keyPem, onMessage) {
  url = url.replace("https://", "wss://");
  console.log(url);

  const ws = new WebSocket(url, {
    cert: certPem,
    key: keyPem,
    rejectUnauthorized: false,
  });

  openSocket[id] = ws;

  ws.on("open", function open() {
    console.log("connected");
  });

  ws.on("message", function incoming(data) {
    console.log(data);
    onMessage(data);
  });

  ws.on("error", (_, err) => {
    logger.error("Websocket received an error: " + err);
  });

  ws.on("close", (_, code, reason) => {
    logger.info("Websocket was closed [" + code + "]: " + reason);
  });
}
