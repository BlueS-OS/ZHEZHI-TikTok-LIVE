import crypto from "node:crypto";

export function userOf(user) {
  if (!user) return { id: "", name: "alguien", username: "", avatar: "" };
  return {
    id: String(user.id || user.idStr || ""),
    name: String(user.nickname || user.displayId || "alguien").slice(0, 80),
    username: String(user.displayId || "").slice(0, 80),
    avatar:
      user.avatarThumb?.urlList?.[0] ||
      user.avatarMedium?.urlList?.[0] ||
      user.avatarLarge?.urlList?.[0] ||
      "",
  };
}

function base(data, kind) {
  return {
    id: String(data?.common?.msgId || crypto.randomUUID()),
    at: Number(data?.common?.createTime || 0) || Date.now(),
    kind,
  };
}

export function normalizeChat(data) {
  return {
    ...base(data, "chat"),
    user: userOf(data.user),
    text: String(data.content || "").slice(0, 500),
  };
}

export function normalizeGift(data) {
  const count = Number(data.repeatCount || data.comboCount || 1) || 1;
  const combo = Boolean(data.gift?.combo);
  const last = Boolean(data.repeatEnd) || !combo;
  if (!last) return null;
  const unit = Number(data.gift?.diamondCount || data.extendedGiftInfo?.diamond_count || 0) || 0;
  return {
    ...base(data, "gift"),
    user: userOf(data.user),
    text: String(data.gift?.name || data.extendedGiftInfo?.name || "regalo").slice(0, 80),
    gift: {
      name: String(data.gift?.name || data.extendedGiftInfo?.name || "regalo").slice(0, 80),
      count,
      diamonds: unit * count,
      image:
        data.gift?.image?.urlList?.[0] ||
        data.gift?.icon?.urlList?.[0] ||
        data.extendedGiftInfo?.image?.url_list?.[0] ||
        "",
    },
    diamonds: unit * count,
    count,
  };
}

export function normalizeFollow(data) {
  return { ...base(data, "follow"), user: userOf(data.user) };
}

export function normalizeShare(data) {
  return { ...base(data, "share"), user: userOf(data.user) };
}

export function normalizeSubscribe(data) {
  return {
    ...base(data, "subscribe"),
    user: userOf(data.user),
    months: Number(data.subMonth || 0) || 1,
  };
}

export function normalizeJoin(data) {
  return { ...base(data, "join"), user: userOf(data.user) };
}

export function normalizeLike(data) {
  return {
    ...base(data, "like"),
    user: userOf(data.user),
    total: Number(data.total || 0) || 0,
    count: Number(data.count || 0) || 0,
  };
}

export function normalizeViewers(data) {
  return {
    ...base(data, "viewers"),
    id: `viewers-${Date.now()}`,
    viewers: Number(data.total || data.totalUser || 0) || 0,
  };
}

export function normalizeQuestion(data) {
  const question = data?.data || {};
  const text =
    question.content ||
    question.question ||
    question.displayText?.text ||
    question.common?.displayText?.text ||
    "";
  return {
    ...base(data, "question"),
    user: userOf(question.user || data.user),
    text: String(text).slice(0, 500),
  };
}
