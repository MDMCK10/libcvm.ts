import { Canvas } from "canvas";
import { EventEmitter } from "events";
import { User } from "./User";
import WebSocket from "ws";
import { ConnectionOptions } from "./ConnectionOptions";
import { DefaultHeaders } from "./Constants";
import { Decode } from "./Guacamole";

export class VM extends EventEmitter {
    screen: Canvas;
    screenContext: CanvasRenderingContext2D;

    name: string;

    websocket: WebSocket;

    users: User[];

    connect(url: string, options: ConnectionOptions): Promise<VM> {
        let vm = new VM();
        var promiseResolve: (value: VM | PromiseLike<VM>) => void,
            promiseReject: (reason: string) => void;

        var promise: Promise<VM> = new Promise((resolve, reject) => {
            promiseResolve = resolve;
            promiseReject = reject;
        });

        vm.websocket = new WebSocket(url, "guacamole", {
            headers: DefaultHeaders
        });

        vm.name = options.vmName

        vm.websocket.on('message', (data) => {
            const content = Decode(data.toString());
            switch (content[0]) {
                case "connect": {
                    switch (parseInt(content[1])) {
                        case 0: {
                            promiseReject("Server rejected connection.");
                            break;
                        }
                        case 1: {
                            promiseResolve(vm);
                        }
                    }
                    break;
                }

                case "nop": {
                    vm.websocket.send("3.nop;");
                    break;
                }

                default: {
                    console.log(content);
                    break;
                }
            }
        });

        vm.websocket.onerror = (err) => promiseReject(err.message);

        promiseResolve(vm);

        return promise;
    }
};