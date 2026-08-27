import { getSupabase } from "./supabase.js";

export async function enqueueJob({
  telegramUserId,
  chatId,
  inputType = "text",
  payload,
  progressMessageId,
  debugMode = false
}) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("gemini_checker_jobs")
    .insert({
      telegram_user_id: telegramUserId || null,
      telegram_chat_id: chatId,
      input_type: inputType,
      input_payload: payload,
      link_count: 0,
      telegram_progress_message_id: progressMessageId,
      debug_mode: debugMode,
      status: "queued"
    })
    .select("id,status,created_at")
    .single();

  if (error) throw error;
  return data;
}

export async function claimJob(workerId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("claim_gemini_checker_job", {
    p_worker_id: workerId
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function completeJob(id, result, extra = {}) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("gemini_checker_jobs")
    .update({
      status: "completed",
      result,
      input_payload: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...extra
    })
    .eq("id", id);
  if (error) throw error;
}

export async function failJob(id, message, extra = {}) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("gemini_checker_jobs")
    .update({
      status: "failed",
      input_payload: null,
      last_error: String(message || "Unknown error").slice(0, 2000),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...extra
    })
    .eq("id", id);
  if (error) throw error;
}

export async function queuedCount() {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("gemini_checker_jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "queued");
  if (error) throw error;
  return count || 0;
}
