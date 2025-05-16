import { Entity, ObjectIdColumn, Column } from "typeorm";
import { ObjectId } from "mongodb";

@Entity()
export class LeaveBalance {
  @Column()
  casual: number;

  @Column()
  sick: number;

  @Column()
  annual: number;

  @Column()
  updatedAt: Date;
}

@Entity()
export class User {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  name: string;

  @Column()
  email: string;

  @Column()
  password: string;

  @Column()
  role: string;

  @Column()
  createdAt: Date;

  // Embedded document in MongoDB
  @Column(type => LeaveBalance)
  leaveBalance: LeaveBalance;
}
