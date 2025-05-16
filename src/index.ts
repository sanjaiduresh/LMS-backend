require("reflect-metadata");
const jwt = require("jsonwebtoken");
const Hapi = require("@hapi/hapi");
const bcrypt = require("bcrypt");
const { AppDataSource } = require("./data-source");
const { ObjectId } = require("mongodb");

const init = async () => {
  await AppDataSource.initialize();
  const userRepo = AppDataSource.getMongoRepository("User");
  const leaveRepo = AppDataSource.getMongoRepository("Leave");

  const server = Hapi.server({
    port: 8000,
    host: '0.0.0.0',
    routes: {
      cors: {
        origin: ["*"],
        credentials: true,
      },
    },
  });

  server.route([
    {
      method: "GET",
      path: "/user/{id}",
      handler: async (req, h) => {
        try {
          const userId = req.params.id;

          // Check if userId is a valid 24-character hex string
          if (!ObjectId.isValid(userId)) {
            return h.response({ error: "Invalid user ID format" }).code(400);
          }

          const user = await userRepo.findOneBy({ _id: new ObjectId(userId) });

          if (!user) {
            return h.response({ error: "User not found" }).code(404);
          }

          const leaves = await leaveRepo.find({
            where: { userId: userId },
          });

          return h.response({ user, leaves }).code(200);
        } catch (err) {
          console.error("Fetch user error:", err);
          return h.response({ error: "Internal Server Error" }).code(500);
        }
      },
    },
    {
      method: "POST",
      path: "/register",
      handler: async (req, h) => {
        try {
          const { name, email, password, role, leaveBalance } = req.payload as {
            name: string;
            email: string;
            password: string;
            role?: string;
            leaveBalance?: {
              casual?: number;
              sick?: number;
              earned?: number;
            };
          };

          // Check if user already exists
          const exists = await userRepo.findOneBy({ email });
          if (exists) {
            return h.response({ error: "User already exists" }).code(409);
          }

          // Hash the password
          const hashed = await bcrypt.hash(password, 10);

          // Set default leave balances if not provided
          const defaultLeaveBalance = {
            casual: leaveBalance?.casual ?? 10,
            sick: leaveBalance?.sick ?? 5,
            earned: leaveBalance?.earned ?? 15,
            updatedAt: new Date(),
          };

          // Save new user
          const user = await userRepo.save({
            name,
            email,
            password: hashed,
            role: role || "employee",
            createdAt: new Date(),
            leaveBalance: defaultLeaveBalance,
          });

          return h.response({ message: "Registered", user }).code(201);
        } catch (error) {
          console.error("Registration error:", error);
          return h.response({ error: "Registration failed" }).code(500);
        }
      },
    },

    {
      method: "POST",
      path: "/login",
      handler: async (req, h) => {
        try {
          const { email, password } = req.payload;
          // Find user by email
          const user = await userRepo.findOneBy({ email });
          if (!user) {
            return h.response({ error: "Invalid email" }).code(401);
          }

          // Compare password
          const match = await bcrypt.compare(password, user.password);
          if (!match) {
            return h.response({ error: "Invalid password" }).code(401);
          }

          // Check if the user has a role (could be 'employee' or 'admin', etc.)
          const userRole = user.role || "employee"; // Default to "employee" if no role is found.

          const token = "DummyToken"; // Replace with actual JWT token generation logic

          return h
            .response({
              token,
              user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: userRole,
                leaveBalance: user.leaveBalance || 0,
              },
            })
            .code(200);
        } catch (err) {
          console.error("Login failed:", err);
          return h.response({ error: "Internal Server Error" }).code(500);
        }
      },
    },
    {
      method: "POST",
      path: "/apply-leave",
      handler: async (req, h) => {
        const { userId, type, from, to, reason } = req.payload;

        // Calculate leave duration
        const fromDate = new Date(from);
        const toDate = new Date(to);
        const timeDiff = Math.abs(toDate.getTime() - fromDate.getTime());
        const days = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1; // Inclusive days

        // Determine if HR approval is sufficient (leave duration <= 2 days)
        let requiredApprovals = [];
        if (days <= 2) {
          requiredApprovals = ["hr", "manager"]; // Both HR and Manager need to approve (lowercase)
        } else {
          requiredApprovals = ["manager"]; // Only HR needs to approve (lowercase)
        }

        const leave = await leaveRepo.save({
          userId,
          type,
          from: new Date(from),
          to: new Date(to),
          createdAt: new Date(),
          status: "Pending", // Status starts as Pending
          reason,
          requiredApprovals, // Include the required approvers (lowercase)
        });

        return h.response({ message: "Leave Applied", leave }).code(201);
      },
    },
    {
      method: "GET",
      path: "/leaves/{userId}",
      handler: async (req, h) => {
        const userId = req.params.userId;
        const leaves = await leaveRepo.find({
          where: { userId: userId },
        });

        return h.response(leaves).code(200);
      },
    },

    {
      method: "GET",
      path: "/admin/leaves",
      handler: async (req, h) => {
        try {
          const leaves = await leaveRepo.find();

          // Convert userIds to ObjectId
          const userObjectIds = leaves.map((leave) => new ObjectId(leave.userId));

          // Fetch matching users
          const users = await userRepo.find({
            where: {
              _id: { $in: userObjectIds },
            },
          });

          // Create userId-to-name map
          const userMap = {};
          users.forEach((user) => {
            userMap[user._id.toString()] = user.name;
          });

          // Enrich leaves with userName
          const enrichedLeaves = leaves.map((leave) => ({
            ...leave,
            userName: userMap[leave.userId.toString()] || "Unknown User",
          }));

          return h.response(enrichedLeaves).code(200);
        } catch (err) {
          console.error("Error fetching enriched leaves:", err);
          return h.response({ error: "Internal Server Error" }).code(500);
        }
      },
    },

    {
      method: "GET",
      path: "/admin/users",
      handler: async (req, h) => {
        try {
          const users = await userRepo.find();
          return h.response(users).code(200);
        } catch (err) {
          console.error("Error fetching users:", err);
          return h.response({ error: "Internal Server Error" }).code(500);
        }
      },
    },
    {
      method: "POST",
      path: "/admin/leave-action",
      handler: async (req, h) => {
        const { leaveId, action, role } = req.payload;
        console.log("Received leave action request:", { leaveId, action, role });
    
        try {
          const leave = await leaveRepo.findOneBy({ _id: new ObjectId(leaveId) });
          if (!leave) return h.response({ error: "Leave not found" }).code(404);
    
          const user = await userRepo.findOneBy({ _id: new ObjectId(leave.userId) });
          if (!user) return h.response({ error: "User not found" }).code(404);
    
          console.log("Leave requiredApprovals:", leave.requiredApprovals);
    
    
          if (!leave.requiredApprovals || !leave.requiredApprovals.includes(role)) {
            return h
              .response({
                error: "You are not authorized to perform this action on this leave",
              })
              .code(403);
          }
    
          // Only validate and deduct leave if action is approved AND all approvals are done after this one
          if (action.toLowerCase() === "approved") {
            // Remove this approver from requiredApprovals
            leave.requiredApprovals = leave.requiredApprovals.filter(r => r !== role);
    
            // If all required approvals are done, then deduct leave and approve
            if (leave.requiredApprovals.length === 0) {
              const fromDate = new Date(leave.from);
              const toDate = new Date(leave.to);
              const timeDiff = Math.abs(toDate.getTime() - fromDate.getTime());
              const days = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1; // Inclusive
    
              const leaveType = leave.type.toLowerCase();
    
              // Validate balance
              if (
                !user.leaveBalance ||
                user.leaveBalance[leaveType] === undefined ||
                user.leaveBalance[leaveType] < days
              ) {
                return h
                  .response({
                    error: `Insufficient ${leaveType} leave balance. Required: ${days}, Available: ${
                      user.leaveBalance?.[leaveType] ?? 0
                    }`,
                  })
                  .code(400);
              }
    
              // Deduct balance
              user.leaveBalance[leaveType] -= days;
              user.leaveBalance.updatedAt = new Date();
              await userRepo.save(user);
    
              leave.status = "approved";
            } else {
              // Still waiting for other approvals
              leave.status = "pending";
            }
    
            await leaveRepo.save(leave);
            return h.response({ message: "Leave action recorded", updatedUser: user }).code(200);
          }
    
          // If action is rejected by any role, set it as rejected immediately
          if (action.toLowerCase() === "rejected") {
            leave.status = "rejected";
            leave.requiredApprovals = []; // Clear to prevent future approval
            await leaveRepo.save(leave);
            return h.response({ message: "Leave rejected" }).code(200);
          }
    
          return h.response({ error: "Invalid action" }).code(400);
        } catch (err) {
          console.error("Leave action failed:", err);
          return h.response({ error: "Internal Server Error" }).code(500);
        }
      },
    }
    
  ]);

  await server.start();
  console.log(`🚀Hapi server running on ${server.info.uri}`);
};

init();