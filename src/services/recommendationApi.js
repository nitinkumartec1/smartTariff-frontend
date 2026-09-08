// SmartTariff Recommendation API Service
// Connects directly to the SmartTariff V4.3 Random Forest Machine Learning Model
// running on the backend (/api/v1/recommendations/predict).
import { simulateRequest } from "./api";
import { collections, getAll, findOne, findById, insert, genId, paginate } from "@/mockApi/db";
import { generateRecommendations as generateFallbackRecommendations } from "@/mockApi/recommendationEngine";

const BACKEND_URLS = [
  "http://localhost:8000/api/v1",
  "http://127.0.0.1:8000/api/v1",
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL,
].filter(Boolean);

function getLatestUsage(customerId) {
  const records = getAll(collections.usage).filter((u) => u.customerId === customerId);
  if (!records.length) return null;
  return records.sort((a, b) => (a.month < b.month ? 1 : -1))[0];
}

function getPreferences(customerId) {
  const profile = findOne(collections.customerProfiles, (p) => p.userId === customerId);
  return profile || {};
}

async function callMlModelApi({ usage, preferences, plans }) {
  for (const baseUrl of BACKEND_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`${baseUrl}/recommendations/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          customer: {
            monthlyBudget: Number(preferences?.monthlyBudget) || 500,
            minimumData: Number(preferences?.minimumData) || Number(usage?.dataUsage) || 30,
            minimumCallMinutes: Number(preferences?.minimumCallMinutes) || Number(usage?.callMinutes) || 350,
            minimumSms: Number(preferences?.minimumSms) || Number(usage?.smsCount) || 40,
            preferredDuration: preferences?.preferredDuration || "28",
            requires5G: Boolean(preferences?.requires5G),
            currentSpending: Number(preferences?.currentSpending) || Number(usage?.currentSpending) || 500,
          },
          usage: {
            dataUsage: Number(usage?.dataUsage) || 30,
            callMinutes: Number(usage?.callMinutes) || 350,
            smsCount: Number(usage?.smsCount) || 40,
            currentSpending: Number(usage?.currentSpending) || 500,
          },
          plans: plans.map((p) => ({
            planId: p._id || p.planId,
            planCode: p.planCode || p.planId,
            name: p.name,
            category: p.category,
            price: Number(p.price),
            monthlyEquivalent: Number(p.monthlyEquivalent || p.price),
            durationMonths: Number(p.durationMonths) || 1,
            discountPercent: Number(p.discountPercent) || 0,
            discountInr: Number(p.discountInr) || 0,
            dataLimit: Number(p.dataLimit),
            callMinutes: Number(p.callMinutes),
            smsLimit: Number(p.smsLimit),
            fiveG: Boolean(p.fiveG),
            validity: Number(p.validity) || 28,
          })),
        }),
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        const mlRecs = json.data?.recommendations;
        if (Array.isArray(mlRecs) && mlRecs.length > 0) {
          console.log(
            `%c[SmartTariff ML]%c Powered by Machine Learning Model: ${json.data?.model || "SmartTariff V4.3"}`,
            "background: #10B981; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;",
            "color: #10B981; font-weight: bold;"
          );
          return {
            results: mlRecs.map((r) => {
              const matched = plans.find(
                (p) => p._id === r.planId || p.planId === r.planId || p.planCode === r.planCode
              );
              return {
                planId: matched?._id || r.planId,
                plan: matched || r.plan,
                rank: r.rank,
                score: r.score,
                reasons: r.reasons,
              };
            }),
            generatedBy: "ml",
            model: json.data?.model || "SmartTariff V4.3",
          };
        }
      }
    } catch {
      // Try next URL or fall back if offline
    }
  }

  return null;
}

export const recommendationApi = {
  generate: async (customerId) => {
    let usage = getLatestUsage(customerId);
    const preferences = getPreferences(customerId);

    if (!usage) {
      const now = new Date();
      const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const callMins = preferences.minimumCallMinutes || 350;
      const numCalls = Math.max(5, Math.round(callMins / 4));
      usage = {
        _id: genId("usg"),
        customerId,
        month: curMonth,
        dataUsage: preferences.minimumData || 30,
        callMinutes: callMins,
        smsCount: preferences.minimumSms || 40,
        numberOfCalls: numCalls,
        averageCallDuration: Number((callMins / numCalls).toFixed(1)),
        currentSpending: preferences.currentSpending || preferences.monthlyBudget || 500,
        createdAt: new Date().toISOString(),
      };
      insert(collections.usage, usage);
    }

    const plans = getAll(collections.plans);

    // 1. Run inference using SmartTariff V4.3 Random Forest model on backend
    const mlResponse = await callMlModelApi({ usage, preferences, plans });

    let results;
    let generatedBy;
    let modelName;

    if (mlResponse && mlResponse.results?.length > 0) {
      results = mlResponse.results;
      generatedBy = "ml";
      modelName = mlResponse.model;
    } else {
      // 2. Fallback to rule engine if backend is not started
      results = generateFallbackRecommendations({ usage, preferences, plans });
      generatedBy = "rule-based";
      modelName = "Rule-based Fallback";
      console.warn("[SmartTariff] ML backend not reachable; using rule fallback");
    }

    const record = {
      _id: genId("rec"),
      customerId,
      plans: results.map((r) => ({
        planId: r.planId,
        rank: r.rank,
        score: r.score,
        reasons: r.reasons,
      })),
      generatedAt: new Date().toISOString(),
      generatedBy,
      model: modelName,
    };
    insert(collections.recommendations, record);

    return {
      success: true,
      message: "OK",
      data: {
        ...record,
        plans: results.map((r) => ({ ...r })),
      },
    };
  },

  getMine: async (customerId) => {
    const records = getAll(collections.recommendations)
      .filter((r) => r.customerId === customerId)
      .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
    const latest = records[0];

    if (!latest) {
      // Auto-generate fresh recommendations with the ML model on initial visit!
      return await recommendationApi.generate(customerId);
    }

    const plans = getAll(collections.plans);
    return {
      success: true,
      message: "OK",
      data: {
        ...latest,
        plans: latest.plans.map((p) => ({
          ...p,
          plan: plans.find((pl) => pl._id === p.planId || pl.planId === p.planId),
        })),
      },
    };
  },

  getById: (id) =>
    simulateRequest(() => {
      const record = findById(collections.recommendations, id);
      if (!record) throw Object.assign(new Error("Recommendation not found"), { status: 404 });
      const plans = getAll(collections.plans);
      return { ...record, plans: record.plans.map((p) => ({ ...p, plan: plans.find((pl) => pl._id === p.planId || pl.planId === p.planId) })) };
    }),

  history: (customerId, { page = 1, limit = 10 } = {}) =>
    simulateRequest(() => {
      const plans = getAll(collections.plans);
      const records = getAll(collections.recommendations)
        .filter((r) => r.customerId === customerId)
        .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))
        .map((r) => {
          const top = r.plans.find((p) => p.rank === 1);
          const plan = plans.find((pl) => pl._id === top?.planId || pl.planId === top?.planId);
          return { _id: r._id, generatedAt: r.generatedAt, topPlanName: plan?.name || "N/A", topScore: top?.score || 0, generatedBy: r.generatedBy, model: r.model };
        });
      return paginate(records, page, limit);
    }),
};

