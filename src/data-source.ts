import "reflect-metadata";
import { DataSource } from "typeorm";
import { User } from "./entity/User";
import { Leave } from "./entity/Leave";
import * as dotenv from "dotenv";

dotenv.config(); // Ensure this is at the top of your file

export const AppDataSource = new DataSource({
    type: "mongodb",
    url: process.env.MONGO_URI,
    synchronize: true,
    database: "leavemanagementsystem",
    logging: false,
    entities: [User, Leave],
    migrations: [],
    subscribers: [],
});
