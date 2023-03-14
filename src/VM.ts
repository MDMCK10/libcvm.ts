import { Canvas } from "canvas";
import { EventEmitter } from "events";
import { User } from "./User";
import WebSocket from "ws";
import { ConnectionOptions } from "./ConnectionOptions";
import { DefaultHeaders } from "./Constants";
import { Decode, Encode } from "./Guacamole";

export class VM extends EventEmitter {
    screen: Canvas;
    screenContext: CanvasRenderingContext2D;

    websocket: WebSocket;

    users: User[];

    url: string;
    options: ConnectionOptions;

    constructor(url: string, options: ConnectionOptions) {
        super();
        this.url = url;
        this.options = options;
    }

    public async connect(): Promise<VM> {
        var promiseResolve: (value: VM | PromiseLike<VM>) => void,
            promiseReject: (reason: string) => void;

        var promise: Promise<VM> = new Promise((resolve, reject) => {
            promiseResolve = resolve;
            promiseReject = reject;
        });

        var promiseFulfilled: boolean;

        this.websocket = new WebSocket(this.url, "guacamole", {
            headers: DefaultHeaders
        });

        this.websocket.onopen = () => {
            this.websocket.send(Encode("rename", this.options.botName));
            this.websocket.send(Encode("connect", this.options.vmName));
        };

        this.websocket.onmessage = (ev) => {
            const content = Decode(ev.data.toString());

            switch (content[0]) {
                case "connect": {
                    switch (parseInt(content[1])) {
                        case 0: {
                            this.websocket.close();
                            this.websocket = null;
                            promiseFulfilled = true;
                            promiseReject("Server rejected connection.");
                            break;
                        }
                        case 1: {
                            promiseResolve(this);
                            promiseFulfilled = true;
                        }
                    }
                    break;
                }

                case "nop": {
                    this.websocket.send("3.nop;");
                    break;
                }

                default: {
                    console.log(content);
                    break;
                }
            }
        };

        this.websocket.onerror = (err) => {
            if(!promiseFulfilled) {
                promiseReject(err.message);
                promiseFulfilled = true;
            }else{
                this.emit("error", err);
            };
        };

        return promise;
    }
};