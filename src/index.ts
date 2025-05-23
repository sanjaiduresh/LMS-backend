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
    host: "localhost",
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
      const { 
        name, 
        email, 
        password, 
        role, 
        leaveBalance,
        managerId 
      } = req.payload as {
        name: string;
        email: string;
        password: string;
        role?: string;
        leaveBalance?: {
          casual?: number;
          sick?: number;
          earned?: number;
        };
        managerId?: string;
      };

      // Check if user already exists
      const exists = await userRepo.findOneBy({ email });
      if (exists) {
        return h.response({ error: "User already exists" }).code(409);
      }

      // Validate manager if provided
      if (managerId) {
        if (!ObjectId.isValid(managerId)) {
          return h.response({ error: "Invalid manager ID format" }).code(400);
        }

        const manager = await userRepo.findOneBy({ 
          _id: new ObjectId(managerId) 
        });
        
        if (!manager) {
          return h.response({ error: "Manager not found" }).code(404);
        }

        // Verify the assigned user is actually a manager
        if (manager.role !== "manager" && manager.role !== "admin") {
          return h.response({ 
            error: "Assigned user is not a manager" 
          }).code(400);
        }
      }

      // For employees, require manager assignment
      if (role === "employee" && !managerId) {
        return h.response({ 
          error: "Manager assignment is required for employees" 
        }).code(400);
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

      // Prepare user data
      const userData: {
        name: string;
        email: string;
        password: string;
        role: string;
        createdAt: Date;
        leaveBalance: {
          casual: number;
          sick: number;
          earned: number;
          updatedAt: Date;
        };
        managerId?: string;
      } = {
        name,
        email,
        password: hashed,
        role: role || "employee",
        createdAt: new Date(),
        leaveBalance: defaultLeaveBalance,
      };

      // Add managerId only if provided
      if (managerId) {
        userData.managerId = managerId;
      }

      // Save new user
      const user = await userRepo.save(userData);

      // Remove password from response
      const { password: _, ...userResponse } = user;

      return h.response({ 
        message: "User registered successfully", 
        user: userResponse 
      }).code(201);
    } catch (error) {
      console.error("Registration error:", error);
      return h.response({ error: "Registration failed" }).code(500);
    }
  },
},{
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
          const userObjectIds = leaves.map(
            (leave) => new ObjectId(leave.userId)
          );

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
        console.log("Received leave action request:", {
          leaveId,
          action,
          role,
        });

        try {
          const leave = await leaveRepo.findOneBy({
            _id: new ObjectId(leaveId),
          });
          if (!leave) return h.response({ error: "Leave not found" }).code(404);

          const user = await userRepo.findOneBy({
            _id: new ObjectId(leave.userId),
          });
          if (!user) return h.response({ error: "User not found" }).code(404);

          console.log("Leave requiredApprovals:", leave.requiredApprovals);

          if (
            !leave.requiredApprovals ||
            !leave.requiredApprovals.includes(role)
          ) {
            return h
              .response({
                error:
                  "You are not authorized to perform this action on this leave",
              })
              .code(403);
          }

          // Only validate and deduct leave if action is approved AND all approvals are done after this one
          if (action.toLowerCase() === "approved") {
            // Remove this approver from requiredApprovals
            leave.requiredApprovals = leave.requiredApprovals.filter(
              (r) => r !== role
            );

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
            return h
              .response({ message: "Leave action recorded", updatedUser: user })
              .code(200);
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
    },
    {
      method: "DELETE",
      path: "/leave/{id}",
      handler: async (req, h) => {
        try {
          const leaveId = req.params.id;
          const leave = await leaveRepo.findOneBy({
            _id: new ObjectId(leaveId),
          });
          if (!leave) return h.response({ error: "Leave not found" }).code(404);

          // allow cancel only by the owner while still pending
          if (leave.status.toLowerCase() !== "pending")
            return h
              .response({ error: "Cannot cancel after processing" })
              .code(400);

          await leaveRepo.delete({ _id: new ObjectId(leaveId) });
          return h.response({ message: "Leave cancelled" }).code(200);
        } catch (err) {
          console.error("Cancel failed:", err);
          return h.response({ error: "Internal Server Error" }).code(500);
        }
      },
    },
    // Add these routes to your existing server routes array

{
  method: "GET",
  path: "/admin/teams",
  handler: async (req, h) => {
    try {
      // Get all managers
      const managers = await userRepo.find({
        where: { 
          role: { $in: ["manager"] }
        }
      });

      // Get all employees with their manager assignments
      const employees = await userRepo.find({
        where: { 
          role: "employee",
          managerId: { $exists: true }
        }
      });

      // Build teams structure
      const teams = managers.map(manager => {
        const teamMembers = employees.filter(emp => 
          emp.managerId === manager._id.toString()
        );

        return {
          manager: {
            _id: manager._id,
            name: manager.name,
            email: manager.email,
            role: manager.role,
            leaveBalance: manager.leaveBalance
          },
          members: teamMembers.map(member => ({
            _id: member._id,
            name: member.name,
            email: member.email,
            role: member.role,
            leaveBalance: member.leaveBalance,
            managerId: member.managerId
          })),
          memberCount: teamMembers.length
        };
      });

      // Also get unassigned employees
      const unassignedEmployees = employees.filter(emp => 
        !emp.managerId || emp.managerId === ""
      );

      return h.response({
        teams,
        unassignedEmployees: unassignedEmployees.map(emp => ({
          _id: emp._id,
          name: emp.name,
          email: emp.email,
          role: emp.role,
          leaveBalance: emp.leaveBalance
        }))
      }).code(200);
    } catch (err) {
      console.error("Error fetching teams:", err);
      return h.response({ error: "Internal Server Error" }).code(500);
    }
  },
},

{
  method: "GET",
  path: "/manager/{managerId}/team",
  handler: async (req, h) => {
    try {
      const managerId = req.params.managerId;

      if (!ObjectId.isValid(managerId)) {
        return h.response({ error: "Invalid manager ID format" }).code(400);
      }

      // Verify manager exists
      const manager = await userRepo.findOneBy({ 
        _id: new ObjectId(managerId) 
      });

      if (!manager) {
        return h.response({ error: "Manager not found" }).code(404);
      }

      if (manager.role !== "manager") {
        return h.response({ error: "User is not a manager" }).code(403);
      }

      // Get team members
      const teamMembers = await userRepo.find({
        where: { 
          managerId: managerId,
          role: "employee"
        }
      });

      // Get leave requests for team members
      const memberIds = teamMembers.map(member => member._id.toString());
      const teamLeaves = await leaveRepo.find({
        where: { 
          userId: { $in: memberIds }
        }
      });

      return h.response({
        manager: {
          _id: manager._id,
          name: manager.name,
          email: manager.email,
          role: manager.role
        },
        members: teamMembers.map(member => ({
          _id: member._id,
          name: member.name,
          email: member.email,
          role: member.role,
          leaveBalance: member.leaveBalance
        })),
        teamLeaves: teamLeaves.map(leave => ({
          ...leave,
          userName: teamMembers.find(m => m._id.toString() === leave.userId)?.name || "Unknown"
        }))
      }).code(200);
    } catch (err) {
      console.error("Error fetching manager team:", err);
      return h.response({ error: "Internal Server Error" }).code(500);
    }
  },
},

{
  method: "PUT",
  path: "/admin/user/{userId}/manager",
  handler: async (req, h) => {
    try {
      const userId = req.params.userId;
      const { managerId } = req.payload;

      if (!ObjectId.isValid(userId)) {
        return h.response({ error: "Invalid user ID format" }).code(400);
      }

      // Find the user
      const user = await userRepo.findOneBy({ 
        _id: new ObjectId(userId) 
      });

      if (!user) {
        return h.response({ error: "User not found" }).code(404);
      }

      if (user.role !== "employee") {
        return h.response({ 
          error: "Only employees can be assigned to managers" 
        }).code(400);
      }

      // Validate new manager if provided
      if (managerId) {
        if (!ObjectId.isValid(managerId)) {
          return h.response({ error: "Invalid manager ID format" }).code(400);
        }

        const manager = await userRepo.findOneBy({ 
          _id: new ObjectId(managerId) 
        });

        if (!manager) {
          return h.response({ error: "Manager not found" }).code(404);
        }

        if (manager.role !== "manager") {
          return h.response({ 
            error: "Assigned user is not a manager" 
          }).code(400);
        }

        user.managerId = managerId;
      } else {
        // Remove manager assignment
        user.managerId = null;
      }

      await userRepo.save(user);

      return h.response({ 
        message: "Manager assignment updated successfully",
        user: {
          _id: user._id,
          name: user.name,
          managerId: user.managerId
        }
      }).code(200);
    } catch (err) {
      console.error("Error updating manager assignment:", err);
      return h.response({ error: "Internal Server Error" }).code(500);
    }
  },
}
  ]);

  await server.start();
  console.log(`🚀Hapi server running on ${server.info.uri}`);
};

init();
