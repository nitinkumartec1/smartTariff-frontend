// Recommendation API Service
// Connects directly to FastAPI backend ML Engine & Recommendation Service
import { api } from "./api";

export const recommendationApi = {
  getMine: async () => {
    return api.get("/recommendations/me");
  },

  getById: async (id) => {
    return api.get(`/recommendations/${id}`);
  },

  predict: async (payload) => {
    return api.post("/recommendations/predict", payload);
  },

  generate: async (payload = {}) => {
    return api.post("/recommendations/generate", typeof payload === "object" ? payload : {});
  },

  getModelStatus: async () => {
    return api.get("/recommendations/model-status");
  },

  listAll: async (params = {}) => {
    return api.get("/admin/recommendations", params);
  },
};
