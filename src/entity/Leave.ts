import { Entity, ObjectIdColumn, Column } from "typeorm";
import { ObjectId } from "mongodb";

@Entity()
export class Leave {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  userId: ObjectId; // Reference to User

  @Column()
  type: string;

  @Column()
  from: string;

  @Column()
  to: string;

  @Column()
  reason: string;

  @Column()
  status: string; // e.g., Pending, Approved, Rejected

  @Column()
  appliedAt: Date;

  @Column("simple-array") // This tells TypeORM to store it as a comma-separated string in MongoDB and hydrate it back to an array
  requiredApprovals: string[];
}