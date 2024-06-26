import { Rank } from "./Constants.js";

export class User {
    username : string;
    rank: Rank;

    constructor(username: string, rank: Rank) {
        this.username = username;
        this.rank = rank;
    }
};