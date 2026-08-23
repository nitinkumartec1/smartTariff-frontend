// Mirrors /api/v1/feedback/* routes
import { simulateRequest } from "./api";
import { collections, getAll, saveAll, insert, genId, paginate } from "@/mockApi/db";

export const feedbackApi = {
  submit: ({ customerId, recommendationId = "latest", rating, comment }) =>
    simulateRequest(() => {
      const all = getAll(collections.feedback);
      const existingIdx = all.findIndex(
        (f) => f.customerId === customerId && (f.recommendationId === recommendationId || (!recommendationId && f.recommendationId === "latest"))
      );

      if (existingIdx >= 0) {
        all[existingIdx] = {
          ...all[existingIdx],
          rating,
          comment: comment || "",
          updatedAt: new Date().toISOString(),
        };
        saveAll(collections.feedback, all);
        return all[existingIdx];
      }

      const record = {
        _id: genId("fb"),
        customerId,
        recommendationId: recommendationId || "latest",
        rating, // 'up' | 'down'
        comment: comment || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      insert(collections.feedback, record);
      return record;
    }),

  mine: (customerId) =>
    simulateRequest(() =>
      getAll(collections.feedback)
        .filter((f) => f.customerId === customerId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    ),

  listAll: ({ page = 1, limit = 10 } = {}) =>
    simulateRequest(() => {
      const users = getAll(collections.users);
      const records = getAll(collections.feedback)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((f) => ({
          ...f,
          customerName: users.find((u) => u._id === f.customerId)?.name || "Customer",
        }));
      return paginate(records, page, limit);
    }),
};

