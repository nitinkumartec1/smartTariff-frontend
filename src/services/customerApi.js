// Mirrors /api/v1/customers/* routes
import { simulateRequest } from "./api";
import { collections, getAll, findOne, updateById, findById, genId, insert, paginate, removeById, saveAll } from "@/mockApi/db";
import { sanitizeUser } from "@/mockApi/authBackend";

const BACKEND_URLS = [
  "http://localhost:8000/api/v1",
  "http://127.0.0.1:8000/api/v1",
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL,
].filter(Boolean);

export const customerApi = {
  getProfile: (userId) =>
    simulateRequest(() => {
      let profile = findOne(collections.customerProfiles, (p) => p.userId === userId);
      if (!profile) {
        profile = insert(collections.customerProfiles, {
          _id: genId("profile"),
          userId,
          currentPlan: null,
          monthlyBudget: 500,
          minimumData: 10,
          minimumCallMinutes: 500,
          minimumSms: 100,
          requires5G: false,
        });
      }
      return profile;
    }),

  updateProfile: (userId, payload) =>
    simulateRequest(() => {
      const profile = findOne(collections.customerProfiles, (p) => p.userId === userId);
      if (!profile) throw Object.assign(new Error("Profile not found"), { status: 404 });
      return updateById(collections.customerProfiles, profile._id, payload);
    }),

  updateUser: (userId, payload) =>
    simulateRequest(() => {
      const updated = updateById(collections.users, userId, payload);
      if (!updated) throw Object.assign(new Error("User not found"), { status: 404 });
      return sanitizeUser(updated);
    }),

  listAll: ({ page = 1, limit = 10, search, status } = {}) =>
    simulateRequest(() => {
      let customers = getAll(collections.users).filter((u) => u.role === "customer");
      if (search) {
        const q = search.toLowerCase();
        customers = customers.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.includes(q));
      }
      if (status === "active") customers = customers.filter((c) => c.isActive);
      if (status === "inactive") customers = customers.filter((c) => !c.isActive);

      const profiles = getAll(collections.customerProfiles);
      const plans = getAll(collections.plans);
      const usage = getAll(collections.usage);

      const enriched = customers.map((c) => {
        const profile = profiles.find((p) => p.userId === c._id);
        const plan = plans.find((p) => p._id === profile?.currentPlan);
        const latestUsage = usage.filter((u) => u.customerId === c._id).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
        return {
          ...sanitizeUser(c),
          currentPlan: plan?.name || "No plan",
          dataUsage: latestUsage?.dataUsage || 0,
          callMinutes: latestUsage?.callMinutes || 0,
        };
      });

      return paginate(enriched, page, limit);
    }),

  getDetail: (userId) =>
    simulateRequest(() => {
      const user = findById(collections.users, userId);
      if (!user) throw Object.assign(new Error("Customer not found"), { status: 404 });
      const profile = findOne(collections.customerProfiles, (p) => p.userId === userId);
      const usage = getAll(collections.usage).filter((u) => u.customerId === userId).sort((a, b) => (a.month < b.month ? 1 : -1));
      const recommendations = getAll(collections.recommendations).filter((r) => r.customerId === userId).sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
      const feedback = getAll(collections.feedback).filter((f) => f.customerId === userId);
      const plans = getAll(collections.plans);
      const currentPlan = plans.find((p) => p._id === profile?.currentPlan) || null;
      return { user: sanitizeUser(user), profile, usage, recommendations, feedback, currentPlan };
    }),

  setStatus: (userId, isActive) =>
    simulateRequest(async () => {
      let token = null;
      try {
        const session = JSON.parse(localStorage.getItem("smarttariff:v1:session") || "{}");
        token = session.token;
      } catch (e) {}

      for (const baseUrl of BACKEND_URLS) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          await fetch(`${baseUrl}/admin/customers/${userId}/status`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ isActive }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          break;
        } catch (e) {
          // fallback
        }
      }

      const updated = updateById(collections.users, userId, { isActive });
      if (!updated) throw Object.assign(new Error("Customer not found"), { status: 404 });
      return sanitizeUser(updated);
    }),

  deleteCustomer: (userId) =>
    simulateRequest(async () => {
      let token = null;
      try {
        const session = JSON.parse(localStorage.getItem("smarttariff:v1:session") || "{}");
        token = session.token;
      } catch (e) {}

      for (const baseUrl of BACKEND_URLS) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          await fetch(`${baseUrl}/admin/customers/${userId}`, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          break;
        } catch (e) {
          // fallback to local cleanup
        }
      }

      const user = findById(collections.users, userId);
      if (!user) throw Object.assign(new Error("Customer not found"), { status: 404 });

      // 1. Remove user
      removeById(collections.users, userId);

      // 2. Cascade remove profile
      const profiles = getAll(collections.customerProfiles).filter((p) => p.userId !== userId);
      saveAll(collections.customerProfiles, profiles);

      // 3. Cascade remove usage
      const usage = getAll(collections.usage).filter((u) => u.customerId !== userId);
      saveAll(collections.usage, usage);

      // 4. Cascade remove recommendations
      const recommendations = getAll(collections.recommendations).filter((r) => r.customerId !== userId);
      saveAll(collections.recommendations, recommendations);

      // 5. Cascade remove feedback
      const feedback = getAll(collections.feedback).filter((f) => f.customerId !== userId);
      saveAll(collections.feedback, feedback);

      return { success: true, message: "Customer and all associated records deleted successfully" };
    }),
};
