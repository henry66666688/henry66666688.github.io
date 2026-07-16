"use strict";

const PUBLIC_CONFIG = window.NANCHONG_PUBLIC_CONFIG || {};
const FAIR_TEST_MODE = PUBLIC_CONFIG.mode === "tester";
const API_BASE = String(PUBLIC_CONFIG.apiBase || "").replace(/\/$/, "");
const TESTER_KEY = String(PUBLIC_CONFIG.testerKey || "");
const STORAGE_NAMESPACE = FAIR_TEST_MODE ? "nanchong-fair-test" : "nanchong-linear-danger";
const STORAGE_SESSION = `${STORAGE_NAMESPACE}-session`;
const STORAGE_MATCH_LENGTH = `${STORAGE_NAMESPACE}-match-length`;
const STORAGE_REVEAL = "nanchong-linear-danger-reveal-hand";
const STORAGE_RECOMMENDATION_PROBABILITIES = "nanchong-linear-danger-recommendation-probabilities";
const STORAGE_PARTICIPANT_ID = "nanchong-fair-test-participant-id";
const STORAGE_PARTICIPANT_TOKEN = "nanchong-fair-test-participant-token";
const STORAGE_PARTICIPANT_NAME = "nanchong-fair-test-participant-name";
const TILE_ASSET_ROOT = String(
  PUBLIC_CONFIG.tileAssetRoot
  || "/assets/assets/tiles/complete-chart-reference-v2/front"
).replace(/\/$/, "");
const DISCARD_DOUBLE_CLICK_MS = 450;

const state = {
  game: null,
  history: null,
  participants: null,
  participant: null,
  pending: false,
  selectedDiscard: null,
  lastDiscardClick: { key: null, at: 0 },
  shownResultKey: null,
  matchLength: Number(localStorage.getItem(STORAGE_MATCH_LENGTH)) === 20 ? 20 : 10,
  showModelHand: !FAIR_TEST_MODE && localStorage.getItem(STORAGE_REVEAL) === "true",
  showRecommendationProbabilities: !FAIR_TEST_MODE
    && localStorage.getItem(STORAGE_RECOMMENDATION_PROBABILITIES) !== "false",
};
const RENDER_CACHE_EMPTY = Symbol("render-cache-empty");
const renderCache = {
  history: RENDER_CACHE_EMPTY,
  participants: RENDER_CACHE_EMPTY,
};
let historyRefreshTask = null;
const tilePreloadImages = [];

const elements = Object.fromEntries(
  [
    "modelIdentity", "completedHands", "remainingHands", "humanScore", "humanWins",
    "modelScore", "modelWins", "scoreMargin", "drawCount", "drawRate", "wallCount",
    "matchState", "matchProgressBar", "errorBanner", "modelDealer", "humanDealer",
    "historyRange", "historyTotalHands", "historyMatchCount", "historyHumanScore",
    "historyHumanWins", "historyModelScore", "historyModelWins", "historyScoreMargin",
    "historyDrawCount", "historyDrawRate",
    "modelMelds", "humanMelds", "modelHand", "humanHand", "modelRiver", "humanRiver",
    "handLabel", "turnStatus", "phaseStatus", "lastAction", "humanDrawSource",
    "actionPrompt", "specialActions", "modelMode", "modelProbability", "modelValue",
    "modelEntropy", "modelDanger", "modelTopActions", "seedLabel", "actionLog",
    "humanRecommendationState", "humanRecommendationAction",
    "humanRecommendationProbability", "humanRecommendationValue",
    "humanDiscardProbabilityMass", "humanRecommendationList",
    "newMatchButton", "nextHandButton", "confirmDiscardButton", "modelHandToggle", "recommendationProbabilityToggle",
    "modelVisibilityMark",
    "humanSelfDraws", "modelSelfDraws", "humanDealIns", "modelDealIns",
    "averageHuRound", "humanTenpaiRound", "modelTenpaiRound", "averageWinFan",
    "claimSummary", "recordCount", "handRecords", "exportCsvButton", "exportJsonButton",
    "historyRecordedMatches", "historyCompletedMatches", "historyHumanSelfDraws",
    "historyModelSelfDraws", "historyHumanDealIns", "historyModelDealIns",
    "historyAverageHuRound", "historyMatchOutcomes", "historyHumanTenpaiRound",
    "historyModelTenpaiRound", "historyHumanAverageWinFan", "historyModelAverageWinFan",
    "historyClaimSummary", "historyPersistenceStatus", "historyRecordCount",
    "historyHandRecords", "historyExportCsvButton", "historyExportJsonButton",
    "participantGate", "participantForm", "participantNameInput", "participantNameError",
    "participantSubmitButton", "testerIdentity", "humanScoreLabel", "historyHumanScoreLabel",
    "participantStatisticsSection", "participantCount", "participantStatisticsList",
    "participantExportJsonButton",
    "resultDialog", "resultKicker", "resultTitle", "resultSummary", "fanDetails",
    "dialogNextHandButton", "dialogCloseButton", "loadingLayer", "loadingText",
  ].map((id) => [id, document.getElementById(id)])
);

const matchLengthButtons = [...document.querySelectorAll("[data-match-length]")];

function removeInviteTokenFromAddressBar() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("access")) return;
  url.searchParams.delete("access");
  const query = url.searchParams.toString();
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${query ? `?${query}` : ""}${url.hash}`
  );
}

const ACTION_LABELS = {
  DISCARD: "打出",
  AN_GANG: "暗杠",
  BU_GANG: "补杠",
  PENG: "碰",
  MING_GANG: "明杠",
  PASS: "过",
};

const PHASE_LABELS = {
  SELF_ACTION_DECISION: "出牌阶段",
  DISCARD_RESPONSE_DECISION: "响应阶段",
  TERMINAL: "本局结束",
};

const TERMINAL_LABELS = {
  SELF_DRAW_HU: "自摸",
  DISCARD_HU: "点炮胡",
  ROB_KONG_HU: "抢杠胡",
  WALL_EXHAUSTED: "流局结算",
};

const WIN_SOURCE_LABELS = {
  self_draw: "自摸",
  discard_win: "点炮胡",
  rob_kong: "抢杠胡",
  wall_exhausted: "流局",
};

const FAN_LABELS = {
  qingyise: "清一色",
  qidui: "七对",
  duiduihu: "对对胡",
  daiyaojiu: "带幺九",
  jiangdui: "将对",
  menqing: "门清",
  zhongzhang: "中张",
  tianhu: "天胡",
  dihu: "地胡",
  gangshanghua: "杠上花",
  gangshangpao: "杠上炮",
  qiangganghu: "抢杠胡",
  base: "基础胡",
  self_draw: "自摸",
  rob_kong: "抢杠胡",
  win_on_kong_draw: "杠上花",
  win_on_kong_discard: "杠上炮",
};

async function api(path, options = {}) {
  const mappedPath = fairApiPath(path);
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (FAIR_TEST_MODE) {
    headers["X-Tester-Key"] = TESTER_KEY;
    if (state.participant?.participant_id && state.participant?.participant_token) {
      headers["X-Participant-Id"] = state.participant.participant_id;
      headers["X-Participant-Token"] = state.participant.participant_token;
    }
  }
  const response = await fetch(`${API_BASE}${mappedPath}`, {
    headers,
    ...options,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.detail || `请求失败 (${response.status})`);
  }
  return payload;
}

function fairApiPath(path) {
  if (!FAIR_TEST_MODE) return path;
  if (path.startsWith("/api/matches")) {
    return path.replace("/api/matches", "/api/tester/matches");
  }
  if (path.startsWith("/api/history/summary")) {
    return path.replace("/api/history/summary", "/api/tester/stats/me");
  }
  if (path === "/api/history/export") return "/api/tester/stats/me/export";
  return path;
}

function applyRuntimeMode() {
  document.body.classList.toggle("fair-tester-mode", FAIR_TEST_MODE);
  elements.participantStatisticsSection.hidden = FAIR_TEST_MODE;
  if (FAIR_TEST_MODE) {
    document.title = "南充麻将 1V1 · 公平测试";
    state.showModelHand = false;
    state.showRecommendationProbabilities = false;
    elements.modelHandToggle.checked = false;
    elements.recommendationProbabilityToggle.checked = false;
  }
}

async function ensureParticipant() {
  if (!FAIR_TEST_MODE) return;
  if (!API_BASE || !TESTER_KEY) {
    throw new Error("公平测试站尚未连接模型服务");
  }

  const participantId = localStorage.getItem(STORAGE_PARTICIPANT_ID);
  const participantToken = localStorage.getItem(STORAGE_PARTICIPANT_TOKEN);
  const participantName = localStorage.getItem(STORAGE_PARTICIPANT_NAME);
  if (participantId && participantToken && participantName) {
    state.participant = {
      participant_id: participantId,
      participant_token: participantToken,
      display_name: participantName,
    };
    try {
      const profile = await api("/api/tester/participants/me");
      state.participant = {
        ...profile,
        participant_token: participantToken,
      };
      updateParticipantIdentity();
      return;
    } catch (_error) {
      clearParticipantIdentity();
    }
  }
  await requestParticipantName();
}

function requestParticipantName() {
  elements.participantGate.hidden = false;
  elements.participantNameError.textContent = "";
  elements.participantNameInput.value = "";
  elements.participantNameInput.focus();
  return new Promise((resolve) => {
    elements.participantForm.onsubmit = async (event) => {
      event.preventDefault();
      const displayName = elements.participantNameInput.value.trim();
      elements.participantNameError.textContent = "";
      elements.participantSubmitButton.disabled = true;
      try {
        const identity = await api("/api/tester/participants", {
          method: "POST",
          body: JSON.stringify({ display_name: displayName }),
        });
        state.participant = identity;
        localStorage.setItem(STORAGE_PARTICIPANT_ID, identity.participant_id);
        localStorage.setItem(STORAGE_PARTICIPANT_TOKEN, identity.participant_token);
        localStorage.setItem(STORAGE_PARTICIPANT_NAME, identity.display_name);
        elements.participantGate.hidden = true;
        elements.participantForm.onsubmit = null;
        updateParticipantIdentity();
        resolve();
      } catch (error) {
        elements.participantNameError.textContent = error instanceof Error
          ? error.message
          : String(error);
      } finally {
        elements.participantSubmitButton.disabled = false;
      }
    };
  });
}

function clearParticipantIdentity() {
  state.participant = null;
  localStorage.removeItem(STORAGE_PARTICIPANT_ID);
  localStorage.removeItem(STORAGE_PARTICIPANT_TOKEN);
  localStorage.removeItem(STORAGE_PARTICIPANT_NAME);
  localStorage.removeItem(STORAGE_SESSION);
}

function updateParticipantIdentity() {
  if (!FAIR_TEST_MODE || !state.participant) return;
  const displayName = state.participant.display_name;
  elements.testerIdentity.hidden = false;
  elements.testerIdentity.textContent = displayName;
  elements.humanScoreLabel.textContent = displayName;
  elements.historyHumanScoreLabel.textContent = `${displayName}累计分`;
  const playerLabel = document.getElementById("humanPlayerLabel");
  if (playerLabel) playerLabel.textContent = displayName;
}

async function restoreOrNewMatch() {
  syncPreferenceControls();
  const sessionId = localStorage.getItem(STORAGE_SESSION);
  if (sessionId) {
    try {
      state.game = await api(`/api/matches/${sessionId}`);
      state.matchLength = Number(state.game.match.target_hands) === 20 ? 20 : 10;
      syncPreferenceControls();
      await refreshHistoryShared();
      return;
    } catch (_error) {
      localStorage.removeItem(STORAGE_SESSION);
    }
  }
  await createMatchRequest();
}

async function newMatch() {
  await withPending("正在创建新比赛", async () => {
    closeResultDialog();
    state.shownResultKey = null;
    await createMatchRequest();
  }, true);
}

async function createMatchRequest() {
  state.game = await api("/api/matches", {
    method: "POST",
    body: JSON.stringify({ target_hands: state.matchLength }),
  });
  clearDiscardSelection();
  localStorage.setItem(STORAGE_SESSION, state.game.session_id);
  await refreshHistoryShared();
}

async function nextHand() {
  if (!state.game || state.game.match.match_complete || !state.game.terminal) return;
  await withPending("模型正在准备下一局", async () => {
    closeResultDialog();
    state.game = await api(`/api/matches/${state.game.session_id}/next-hand`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    clearDiscardSelection();
    await refreshHistoryShared();
  });
}

async function submitAction(actionId) {
  if (!state.game || state.pending) return;
  await withPending("模型思考中", async () => {
    const completedHandsBefore = Number(state.game.match.completed_hands) || 0;
    state.game = await api(`/api/matches/${state.game.session_id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action_id: actionId }),
    });
    clearDiscardSelection();
    const completedHandsAfter = Number(state.game.match.completed_hands) || 0;
    if (completedHandsAfter > completedHandsBefore) scheduleHistoryRefresh();
  });
}

function refreshHistoryShared() {
  if (!historyRefreshTask) {
    historyRefreshTask = refreshHistory().finally(() => {
      historyRefreshTask = null;
    });
  }
  return historyRefreshTask;
}

function scheduleHistoryRefresh() {
  void refreshHistoryShared().then(() => render());
}

async function refreshHistory() {
  try {
    state.history = await api("/api/history/summary?recent_limit=30");
    if (!FAIR_TEST_MODE && (!state.participants || state.game?.terminal)) {
      await refreshParticipants();
    }
  } catch (error) {
    state.history = {
      ...(state.history || emptyHistory()),
      last_error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function refreshParticipants() {
  if (FAIR_TEST_MODE) return;
  try {
    state.participants = await api("/api/history/participants");
  } catch (error) {
    state.participants = {
      participant_count: 0,
      participants: [],
      last_error: error instanceof Error ? error.message : String(error),
    };
  }
}

function emptyHistory() {
  return {
    persistent: false,
    has_history: false,
    recorded_matches: 0,
    completed_matches: 0,
    total_hands: 0,
    human_hu_wins: 0,
    model_hu_wins: 0,
    wall_exhausted_hands: 0,
    human_win_rate: 0,
    model_win_rate: 0,
    draw_rate: 0,
    human_score: 0,
    model_score: 0,
    score_margin: 0,
    recent_hand_records: [],
  };
}

async function withPending(message, task, fullScreen = false) {
  if (state.pending) return;
  state.pending = true;
  setError("");
  elements.loadingText.textContent = message;
  if (fullScreen) elements.loadingLayer.hidden = false;
  setControlsDisabled(true);
  if (!fullScreen && state.game) elements.turnStatus.textContent = message;
  try {
    await task();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  } finally {
    state.pending = false;
    elements.loadingLayer.hidden = true;
    render();
  }
}

function render() {
  const game = state.game;
  syncPreferenceControls();
  if (renderCache.history !== state.history) {
    renderHistory(state.history || emptyHistory());
    renderCache.history = state.history;
  }
  if (renderCache.participants !== state.participants) {
    renderParticipantStatistics(state.participants);
    renderCache.participants = state.participants;
  }
  if (!game) {
    setControlsDisabled(state.pending);
    return;
  }
  const human = game.players.find((player) => player.role === "human");
  const model = game.players.find((player) => player.role === "model");
  const match = game.match;
  const modelInfo = game.model;
  reconcileDiscardSelection(game.legal_actions);

  elements.modelIdentity.textContent = [
    modelInfo.name,
    `Seed ${modelInfo.training_seed}`,
    `${formatCompactGames(modelInfo.base_games_seen)} + ${formatCompactGames(modelInfo.continuation_games_seen)} 局`,
  ].join(" · ");
  elements.completedHands.textContent = `${match.completed_hands} / ${match.target_hands}`;
  elements.remainingHands.textContent = match.match_complete
    ? "比赛已完成"
    : `剩余 ${match.remaining_hands} 局`;
  elements.humanScore.textContent = formatSigned(match.human_score);
  elements.humanWins.textContent = `${match.human_hu_wins} 胡 · ${formatPercent(match.human_win_rate)}`;
  elements.modelScore.textContent = formatSigned(match.model_score);
  elements.modelWins.textContent = `${match.model_hu_wins} 胡 · ${formatPercent(match.model_win_rate)}`;
  elements.scoreMargin.textContent = formatSigned(match.score_margin);
  elements.drawCount.textContent = String(match.wall_exhausted_hands);
  elements.drawRate.textContent = formatPercent(match.draw_rate);
  elements.wallCount.textContent = `${game.remaining_wall_count} 张`;
  elements.matchState.textContent = match.match_complete ? "比赛结束" : `第 ${game.hand_number} 局`;
  elements.matchProgressBar.style.width = `${Math.min(100, (match.completed_hands / match.target_hands) * 100)}%`;
  elements.handLabel.textContent = `第 ${game.hand_number} / ${match.target_hands} 局`;
  elements.seedLabel.textContent = `Seed ${game.seed}`;
  elements.modelDealer.hidden = !model.is_dealer;
  elements.humanDealer.hidden = !human.is_dealer;
  elements.humanDrawSource.textContent = drawSourceLabel(human);
  const modelHandCount = Number.isInteger(model.hand_count)
    ? model.hand_count
    : model.hand.length;
  elements.modelVisibilityMark.textContent = FAIR_TEST_MODE
    ? `公平对局 · ${modelHandCount} 张暗牌`
    : state.showModelHand
    ? "手牌已公开 · 仅供分析"
    : `手牌已隐藏 · ${modelHandCount} 张`;

  renderMelds(elements.modelMelds, model.melds);
  renderMelds(elements.humanMelds, human.melds);
  renderHand(elements.modelHand, model, [], { hidden: !state.showModelHand });
  renderHand(elements.humanHand, human, game.legal_actions, {
    recommendations: game.human_recommendation?.discard_candidates || [],
  });
  renderRiver(elements.modelRiver, model.discards, game, model.player_id);
  renderRiver(elements.humanRiver, human.discards, game, human.player_id);
  renderTurn(game);
  renderActions(game.legal_actions);
  renderHumanRecommendation(game.human_recommendation);
  renderModelDecision(game.last_model_decision);
  renderMatchStatistics(match);
  renderHandRecords(match.hand_records);
  renderActionLog(game.action_log);
  setControlsDisabled(state.pending);
  maybeShowResult(game);
}

function renderHand(container, player, legalActions, options = {}) {
  container.replaceChildren();
  if (options.hidden) {
    const hiddenTileCount = Number.isInteger(player.hand_count)
      ? player.hand_count
      : player.hand.length;
    for (let index = 0; index < hiddenTileCount; index += 1) {
      container.appendChild(createTileBack());
    }
    return;
  }
  const discardByTile = new Map(
    legalActions
      .filter((action) => action.action_family === "DISCARD")
      .map((action) => [action.tile_id, action.action_id])
  );
  const recommendationByTile = new Map(
    (options.recommendations || []).map((candidate) => [candidate.tile_id, candidate])
  );
  const annotatedRecommendationTiles = new Set();
  const drawIndex = player.current_draw_tile == null
    ? -1
    : player.hand.lastIndexOf(player.current_draw_tile);
  player.hand.forEach((tileId, index) => {
    const actionId = discardByTile.get(tileId);
    const recommendation = recommendationByTile.get(tileId);
    const annotateRecommendation = recommendation && !annotatedRecommendationTiles.has(tileId)
      ? recommendation
      : null;
    if (annotateRecommendation) annotatedRecommendationTiles.add(tileId);
    container.appendChild(createTile(tileId, {
      actionId,
      drawn: index === drawIndex,
      disabled: state.pending,
      handIndex: index,
      selected: actionId != null && state.selectedDiscard?.handIndex === index,
      recommendation: annotateRecommendation,
    }));
  });
}

function createTileBack() {
  const tile = document.createElement("div");
  tile.className = "tile tile-back";
  tile.setAttribute("aria-label", "隐藏的模型手牌");
  tile.innerHTML = "<span>南</span>";
  return tile;
}

function renderMelds(container, melds) {
  container.replaceChildren();
  melds.forEach((meld) => {
    const group = document.createElement("div");
    group.className = "meld-group";
    group.title = meldLabel(meld.meld_type);
    (meld.tile_ids || []).forEach((tileId, index, tiles) => {
      group.appendChild(createTile(tileId, {
        small: true,
        concealedMeld: Boolean(meld.concealed) && (index === 0 || index === tiles.length - 1),
      }));
    });
    container.appendChild(group);
  });
}

function renderRiver(container, discards, game, playerId) {
  container.replaceChildren();
  discards.forEach((tileId, index) => {
    const isLast = game.last_discard_player === playerId
      && game.last_discard_tile === tileId
      && index === discards.length - 1;
    container.appendChild(createTile(tileId, { small: true, lastDiscard: isLast }));
  });
}

function createTile(tileId, options = {}) {
  const interactive = Number.isInteger(options.actionId);
  const showRecommendation = Boolean(
    options.recommendation && state.showRecommendationProbabilities
  );
  const selected = interactive && Boolean(options.selected);
  const tile = document.createElement(interactive ? "button" : "div");
  const meta = tileMeta(tileId);
  tile.className = [
    "tile", meta.className, options.small ? "small" : "", options.drawn ? "drawn" : "",
    options.lastDiscard ? "last-discard" : "", options.concealedMeld ? "concealed-meld" : "",
    interactive ? "legal" : "", selected ? "selected-discard" : "",
    showRecommendation ? "recommended" : "",
  ].filter(Boolean).join(" ");
  const face = document.createElement("img");
  face.className = "tile-face";
  face.src = tileImagePath(tileId);
  face.alt = "";
  face.draggable = false;
  face.decoding = "async";

  const fallback = document.createElement("span");
  fallback.className = "tile-text-fallback";
  fallback.hidden = true;
  fallback.innerHTML = `<span class="rank">${meta.rank}</span><span class="suit">${meta.suit}</span>`;
  face.addEventListener("error", () => {
    face.hidden = true;
    fallback.hidden = false;
  }, { once: true });
  tile.append(face, fallback);

  if (showRecommendation) {
    const badge = document.createElement("span");
    badge.className = "recommendation-badge";
    const rank = document.createElement("i");
    rank.textContent = `#${options.recommendation.rank}`;
    const probability = document.createElement("span");
    probability.className = "recommendation-probability-value";
    probability.textContent = formatPercent(options.recommendation.probability);
    badge.append(rank, probability);
    tile.appendChild(badge);
  }
  const recommendationText = showRecommendation
    ? `，模型推荐第 ${options.recommendation.rank}，全动作概率 ${formatPercent(options.recommendation.probability)}，弃牌内概率 ${formatPercent(options.recommendation.conditional_discard_probability)}`
    : "";
  tile.setAttribute("aria-label", `${meta.label}${recommendationText}`);
  tile.title = interactive
    ? `单击选择 ${meta.label}，双击直接打出${recommendationText}`
    : meta.label;
  if (interactive) {
    tile.type = "button";
    tile.disabled = Boolean(options.disabled);
    tile.dataset.actionId = String(options.actionId);
    tile.dataset.tileId = String(tileId);
    tile.dataset.handIndex = String(options.handIndex);
    tile.setAttribute("aria-pressed", String(selected));
    tile.addEventListener("click", (event) => {
      handleDiscardTileActivation(event, options.actionId, tileId, options.handIndex);
    });
  }
  return tile;
}

function tileImagePath(tileId) {
  const id = Number(tileId);
  const rank = (id % 9) + 1;
  if (id < 9) return `${TILE_ASSET_ROOT}/wan-${rank}.png`;
  if (id < 18) return `${TILE_ASSET_ROOT}/dot-${rank}.png`;
  const filename = rank === 1 ? "bamboo-1-yaoji.png" : `bamboo-${rank}.png`;
  return `${TILE_ASSET_ROOT}/${filename}`;
}

function scheduleTileFacePreload() {
  if (tilePreloadImages.length) return;
  const preload = () => {
    for (let tileId = 0; tileId < 27; tileId += 1) {
      const face = new Image();
      face.decoding = "async";
      face.src = tileImagePath(tileId);
      tilePreloadImages.push(face);
    }
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(preload, { timeout: 1_500 });
  } else {
    window.setTimeout(preload, 250);
  }
}

function renderHumanRecommendation(recommendation) {
  elements.humanRecommendationList.replaceChildren();
  if (!recommendation) {
    elements.humanRecommendationState.textContent = state.game?.terminal ? "本局已结束" : "等待你的回合";
    elements.humanRecommendationAction.textContent = "--";
    elements.humanRecommendationProbability.textContent = "--";
    elements.humanRecommendationValue.textContent = "--";
    elements.humanDiscardProbabilityMass.textContent = "--";
    return;
  }

  const best = recommendation.recommended_action;
  const candidates = recommendation.discard_candidates || [];
  elements.humanRecommendationState.textContent = candidates.length
    ? "同模型 · 玩家视角"
    : "当前无弃牌动作";
  elements.humanRecommendationAction.textContent = best ? actionCandidateLabel(best) : "--";
  elements.humanRecommendationProbability.textContent = formatPercent(recommendation.probability);
  elements.humanRecommendationValue.textContent = formatNumber(recommendation.value, 3);
  elements.humanDiscardProbabilityMass.textContent = formatPercent(recommendation.discard_probability_mass);

  candidates.forEach((candidate) => {
    const row = document.createElement("div");
    row.className = `recommendation-row rank-${candidate.rank}`;
    const conditional = Math.max(0, Math.min(1, Number(candidate.conditional_discard_probability) || 0));
    row.innerHTML = `
      <span class="recommendation-index">#${candidate.rank}</span>
      <span class="recommendation-action">${escapeHtml(actionCandidateLabel(candidate))}</span>
      <span class="recommendation-probabilities">
        <b>${formatPercent(candidate.probability)}</b>
        <small>弃牌内 ${formatPercent(candidate.conditional_discard_probability)}</small>
      </span>
      <i class="recommendation-bar" style="--recommendation-width:${(conditional * 100).toFixed(2)}%"></i>
    `;
    elements.humanRecommendationList.appendChild(row);
  });
}

function tileMeta(tileId) {
  const id = Number(tileId);
  const rank = (id % 9) + 1;
  const suitIndex = Math.floor(id / 9);
  const suits = [
    { suit: "万", className: "wan" },
    { suit: "筒", className: "tong" },
    { suit: "条", className: "tiao" },
  ];
  const suit = suits[suitIndex] || suits[0];
  return { rank, suit: suit.suit, className: suit.className, label: `${rank}${suit.suit}` };
}

function renderTurn(game) {
  if (game.match.match_complete) {
    elements.turnStatus.textContent = "比赛完成";
    elements.phaseStatus.textContent = `${game.match.human_score} : ${game.match.model_score}`;
  } else if (game.terminal) {
    elements.turnStatus.textContent = "本局结束";
    elements.phaseStatus.textContent = TERMINAL_LABELS[game.terminal_reason] || game.terminal_reason;
  } else if (state.pending) {
    elements.turnStatus.textContent = "模型思考中";
    elements.phaseStatus.textContent = PHASE_LABELS[game.phase] || game.phase;
  } else {
    elements.turnStatus.textContent = "你的回合";
    elements.phaseStatus.textContent = PHASE_LABELS[game.phase] || game.phase;
  }
  const last = game.action_log.at(-1);
  elements.lastAction.textContent = last ? actionEventLabel(last) : "开局摸牌";
}

function renderActions(actions) {
  elements.specialActions.replaceChildren();
  elements.confirmDiscardButton.hidden = true;
  if (!state.game || state.game.terminal) {
    elements.actionPrompt.textContent = state.game?.match.match_complete ? "比赛已完成" : "本局已结算";
    return;
  }
  if (state.pending) {
    elements.actionPrompt.textContent = "模型思考中";
    return;
  }
  const hasDiscard = actions.some((action) => action.action_family === "DISCARD");
  const special = actions.filter((action) => action.action_family !== "DISCARD");
  if (hasDiscard) {
    const selected = selectedDiscardAction(actions);
    elements.confirmDiscardButton.hidden = false;
    elements.confirmDiscardButton.disabled = state.pending || !selected;
    elements.confirmDiscardButton.textContent = selected
      ? `确认打出 ${tileMeta(selected.tile_id).label}`
      : "确认打出";
    elements.actionPrompt.textContent = selected
      ? `已选择 ${tileMeta(selected.tile_id).label}`
      : "请选择一张牌";
  } else {
    elements.actionPrompt.textContent = "请选择响应动作";
  }
  special.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `action-button ${action.action_family === "PASS" ? "pass" : "claim"}`;
    const tileText = action.tile_id == null ? "" : ` ${tileMeta(action.tile_id).label}`;
    button.textContent = `${ACTION_LABELS[action.action_family] || action.action_family}${tileText}`;
    button.title = button.textContent;
    button.disabled = state.pending;
    button.addEventListener("click", () => submitAction(action.action_id));
    elements.specialActions.appendChild(button);
  });
}

function handleDiscardTileActivation(event, actionId, tileId, handIndex) {
  event.preventDefault();
  if (state.pending || !isDiscardActionLegal(actionId, tileId)) return;

  const now = performance.now();
  const clickKey = `${actionId}:${handIndex}`;
  const isDoubleClick = state.lastDiscardClick.key === clickKey
    && now - state.lastDiscardClick.at <= DISCARD_DOUBLE_CLICK_MS;
  state.lastDiscardClick = isDoubleClick
    ? { key: null, at: 0 }
    : { key: clickKey, at: now };
  state.selectedDiscard = { actionId, tileId, handIndex };
  syncDiscardSelectionUi();

  if (isDoubleClick) {
    void submitAction(actionId);
  }
}

function confirmSelectedDiscard() {
  const selected = selectedDiscardAction();
  if (!selected || state.pending) return;
  state.lastDiscardClick = { key: null, at: 0 };
  void submitAction(selected.action_id);
}

function selectedDiscardAction(actions = state.game?.legal_actions || []) {
  if (!state.selectedDiscard) return null;
  return actions.find((action) => (
    action.action_family === "DISCARD"
    && String(action.action_id) === String(state.selectedDiscard.actionId)
    && Number(action.tile_id) === Number(state.selectedDiscard.tileId)
  )) || null;
}

function isDiscardActionLegal(actionId, tileId) {
  return Boolean((state.game?.legal_actions || []).some((action) => (
    action.action_family === "DISCARD"
    && String(action.action_id) === String(actionId)
    && Number(action.tile_id) === Number(tileId)
  )));
}

function reconcileDiscardSelection(actions) {
  if (state.selectedDiscard && !selectedDiscardAction(actions)) {
    clearDiscardSelection();
  }
}

function clearDiscardSelection() {
  state.selectedDiscard = null;
  state.lastDiscardClick = { key: null, at: 0 };
}

function syncDiscardSelectionUi() {
  elements.humanHand.querySelectorAll("button.tile[data-action-id]").forEach((tile) => {
    const selected = String(tile.dataset.actionId) === String(state.selectedDiscard?.actionId)
      && Number(tile.dataset.handIndex) === Number(state.selectedDiscard?.handIndex);
    tile.classList.toggle("selected-discard", selected);
    tile.setAttribute("aria-pressed", String(selected));
  });
  renderActions(state.game?.legal_actions || []);
  setControlsDisabled(state.pending);
}

function renderModelDecision(decision) {
  if (!decision) {
    elements.modelProbability.textContent = "--";
    elements.modelValue.textContent = "--";
    elements.modelEntropy.textContent = "--";
    elements.modelDanger.textContent = "--";
    elements.modelTopActions.replaceChildren();
    return;
  }
  elements.modelProbability.textContent = formatPercent(decision.probability);
  elements.modelValue.textContent = formatNumber(decision.value, 3);
  elements.modelEntropy.textContent = formatNumber(decision.entropy, 3);
  elements.modelDanger.textContent = decision.danger_probability == null
    ? "非弃牌动作"
    : formatPercent(decision.danger_probability);
  elements.modelTopActions.replaceChildren();
  (decision.top_actions || []).slice(0, 3).forEach((candidate) => {
    const row = document.createElement("div");
    row.innerHTML = `<span>${escapeHtml(actionCandidateLabel(candidate))}</span><b>${formatPercent(candidate.probability)}</b>`;
    elements.modelTopActions.appendChild(row);
  });
}

function actionCandidateLabel(candidate) {
  const label = ACTION_LABELS[candidate.action_family] || candidate.action_family;
  return candidate.tile_id == null ? label : `${label} ${tileMeta(candidate.tile_id).label}`;
}

function renderMatchStatistics(match) {
  elements.humanSelfDraws.textContent = String(match.human_self_draw_wins);
  elements.modelSelfDraws.textContent = String(match.model_self_draw_wins);
  elements.humanDealIns.textContent = String(match.human_deal_in_count);
  elements.modelDealIns.textContent = String(match.model_deal_in_count);
  elements.averageHuRound.textContent = formatNullableNumber(match.average_hu_round, "巡");
  elements.humanTenpaiRound.textContent = formatNullableNumber(match.human_average_tenpai_round, "巡");
  elements.modelTenpaiRound.textContent = formatNullableNumber(match.model_average_tenpai_round, "巡");
  elements.averageWinFan.textContent = `你 ${formatNullableNumber(match.human_average_win_fan, "")} / 模型 ${formatNullableNumber(match.model_average_win_fan, "")}`;
  const humanActions = match.human_action_family_counts || {};
  const modelActions = match.model_action_family_counts || {};
  elements.claimSummary.textContent = [
    `你：碰 ${humanActions.PENG || 0}，杠 ${sumGangActions(humanActions)}`,
    `模型：碰 ${modelActions.PENG || 0}，杠 ${sumGangActions(modelActions)}`,
  ].join(" · ");
}

function renderHistory(history) {
  elements.historyTotalHands.textContent = `${history.total_hands || 0} 局`;
  elements.historyMatchCount.textContent = `${history.recorded_matches || 0} 场有记录比赛`;
  elements.historyHumanScore.textContent = formatSigned(history.human_score || 0);
  elements.historyHumanWins.textContent = `${history.human_hu_wins || 0} 胡 · ${formatPercent(history.human_win_rate)}`;
  elements.historyModelScore.textContent = formatSigned(history.model_score || 0);
  elements.historyModelWins.textContent = `${history.model_hu_wins || 0} 胡 · ${formatPercent(history.model_win_rate)}`;
  elements.historyScoreMargin.textContent = formatSigned(history.score_margin || 0);
  elements.historyDrawCount.textContent = String(history.wall_exhausted_hands || 0);
  elements.historyDrawRate.textContent = formatPercent(history.draw_rate);
  elements.historyRecordedMatches.textContent = String(history.recorded_matches || 0);
  elements.historyCompletedMatches.textContent = String(history.completed_matches || 0);
  elements.historyHumanSelfDraws.textContent = String(history.human_self_draw_wins || 0);
  elements.historyModelSelfDraws.textContent = String(history.model_self_draw_wins || 0);
  elements.historyHumanDealIns.textContent = String(history.human_deal_in_count || 0);
  elements.historyModelDealIns.textContent = String(history.model_deal_in_count || 0);
  elements.historyAverageHuRound.textContent = formatNullableNumber(history.average_hu_round, "巡");
  elements.historyMatchOutcomes.textContent = [
    history.human_match_wins || 0,
    history.model_match_wins || 0,
    history.tied_matches || 0,
  ].join(" / ");
  elements.historyHumanTenpaiRound.textContent = formatNullableNumber(history.human_average_tenpai_round, "巡");
  elements.historyModelTenpaiRound.textContent = formatNullableNumber(history.model_average_tenpai_round, "巡");
  elements.historyHumanAverageWinFan.textContent = formatNullableNumber(history.human_average_win_fan, "番");
  elements.historyModelAverageWinFan.textContent = formatNullableNumber(history.model_average_win_fan, "番");

  const humanActions = history.human_action_family_counts || {};
  const modelActions = history.model_action_family_counts || {};
  elements.historyClaimSummary.textContent = [
    `你累计：碰 ${humanActions.PENG || 0}，杠 ${sumGangActions(humanActions)}`,
    `模型累计：碰 ${modelActions.PENG || 0}，杠 ${sumGangActions(modelActions)}`,
  ].join(" · ");

  elements.historyRange.textContent = history.first_recorded_at
    ? `自 ${formatHistoryDate(history.first_recorded_at, false)} · 更新于 ${formatHistoryDate(history.last_recorded_at, true)}`
    : "尚无已完成对局 · 从本版本开始自动保存";
  elements.historyPersistenceStatus.classList.toggle("error", Boolean(history.last_error));
  elements.historyPersistenceStatus.textContent = history.last_error
    ? `历史保存异常：${history.last_error}`
    : history.persistent
    ? "已自动保存到本机，刷新网页或重启服务后仍会保留"
    : "当前为临时历史存储";

  renderHistoryRecords(history.recent_hand_records || [], history.total_hands || 0);
}

function renderParticipantStatistics(report) {
  if (FAIR_TEST_MODE) return;
  const participants = report?.participants || [];
  elements.participantCount.textContent = `${participants.length} 人`;
  elements.participantStatisticsList.replaceChildren();
  elements.participantExportJsonButton.disabled = !participants.length;

  if (report?.last_error) {
    const error = document.createElement("p");
    error.className = "participant-empty error";
    error.textContent = `读取测试人员统计失败：${report.last_error}`;
    elements.participantStatisticsList.appendChild(error);
    return;
  }
  if (!participants.length) {
    const empty = document.createElement("p");
    empty.className = "participant-empty";
    empty.textContent = "尚无实名测试数据";
    elements.participantStatisticsList.appendChild(empty);
    return;
  }

  participants.forEach((participant) => {
    const summary = participant.summary || emptyHistory();
    const card = document.createElement("article");
    card.className = "participant-stat-card";
    const header = document.createElement("header");
    const name = document.createElement("strong");
    const identity = document.createElement("span");
    name.textContent = participant.display_name;
    identity.textContent = participant.participant_id.slice(0, 8);
    header.append(name, identity);

    const metrics = document.createElement("dl");
    metrics.innerHTML = [
      participantMetric("对局", `${summary.total_hands || 0} 局`),
      participantMetric("比赛", `${summary.completed_matches || 0} 场完成`),
      participantMetric("总分", formatSigned(summary.human_score || 0)),
      participantMetric("胡牌率", formatPercent(summary.human_win_rate)),
      participantMetric("自摸 / 点炮", `${summary.human_self_draw_wins || 0} / ${summary.human_deal_in_count || 0}`),
      participantMetric("平均胡牌巡", formatNullableNumber(summary.average_hu_round, "巡")),
      participantMetric("平均听牌巡", formatNullableNumber(summary.human_average_tenpai_round, "巡")),
      participantMetric("平均胡番", formatNullableNumber(summary.human_average_win_fan, "番")),
      participantMetric("碰 / 杠", `${summary.human_action_family_counts?.PENG || 0} / ${sumGangActions(summary.human_action_family_counts || {})}`),
      participantMetric("比赛胜负", `${summary.human_match_wins || 0} / ${summary.model_match_wins || 0} / ${summary.tied_matches || 0}`),
    ].join("");
    card.append(header, metrics);
    elements.participantStatisticsList.appendChild(card);
  });
}

function participantMetric(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderHistoryRecords(records, totalHands) {
  elements.historyHandRecords.replaceChildren();
  elements.historyRecordCount.textContent = records.length
    ? `最近 ${records.length} / ${totalHands} 条`
    : "0 条";
  if (!records.length) {
    const empty = document.createElement("li");
    empty.className = "empty-log";
    empty.textContent = "完成一局后会永久记录在这里";
    elements.historyHandRecords.appendChild(empty);
    return;
  }
  records.forEach((record) => {
    const item = document.createElement("li");
    const outcome = record.winner === "human"
      ? "你胡"
      : record.winner === "model"
      ? "模型胡"
      : "流局";
    const reason = WIN_SOURCE_LABELS[record.terminal_reason] || record.terminal_reason;
    const round = record.end_round == null ? "--" : `${record.end_round} 巡`;
    item.className = record.human_score > 0 ? "positive" : record.human_score < 0 ? "negative" : "neutral";
    const participantName = record.participant_name || (FAIR_TEST_MODE
      ? state.participant?.display_name
      : "未命名历史");
    item.title = `${participantName} · 会话 ${record.session_id} · 第 ${record.hand_number} 局`;
    item.innerHTML = [
      `<span class="record-index">#${record.history_id}</span>`,
      `<span class="record-result"><b>${escapeHtml(outcome)}</b><small>${escapeHtml(participantName)} · ${escapeHtml(formatHistoryDate(record.recorded_at, true))} · 第 ${record.hand_number} 局 · ${escapeHtml(reason)} · ${round}</small></span>`,
      `<span class="record-fan">${record.additive_fan || 0} 番</span>`,
      `<strong>${formatSigned(record.human_score || 0)}</strong>`,
    ].join("");
    elements.historyHandRecords.appendChild(item);
  });
}

function formatHistoryDate(value, includeTime) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", includeTime
    ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
    : { year: "numeric", month: "2-digit", day: "2-digit" }
  ).format(date);
}

function sumGangActions(counts) {
  return (counts.MING_GANG || 0) + (counts.AN_GANG || 0) + (counts.BU_GANG || 0);
}

function renderHandRecords(records) {
  elements.handRecords.replaceChildren();
  elements.recordCount.textContent = `${records.length} 条`;
  if (!records.length) {
    const empty = document.createElement("li");
    empty.className = "empty-log";
    empty.textContent = "完成首局后显示逐局结果";
    elements.handRecords.appendChild(empty);
    return;
  }
  [...records].reverse().forEach((record) => {
    const item = document.createElement("li");
    const outcome = record.winner === "human"
      ? "你胡"
      : record.winner === "model"
      ? "模型胡"
      : "流局";
    item.className = record.human_score > 0 ? "positive" : record.human_score < 0 ? "negative" : "neutral";
    item.innerHTML = [
      `<span class="record-index">${String(record.hand_number).padStart(2, "0")}</span>`,
      `<span class="record-result"><b>${outcome}</b><small>${WIN_SOURCE_LABELS[record.terminal_reason] || record.terminal_reason} · ${record.end_round} 巡</small></span>`,
      `<span class="record-fan">${record.additive_fan} 番</span>`,
      `<strong>${formatSigned(record.human_score)}</strong>`,
    ].join("");
    elements.handRecords.appendChild(item);
  });
}

function renderActionLog(log) {
  elements.actionLog.replaceChildren();
  if (!log.length) {
    const empty = document.createElement("li");
    empty.className = "empty-log";
    empty.textContent = "尚无动作";
    elements.actionLog.appendChild(empty);
    return;
  }
  [...log].reverse().forEach((event) => {
    const row = document.createElement("li");
    const actor = document.createElement("span");
    actor.className = `actor ${event.actor}`;
    actor.textContent = event.actor === "human" ? "你" : "模型";
    const action = document.createElement("span");
    action.textContent = actionEventLabel(event, false);
    const confidence = document.createElement("span");
    confidence.className = "confidence";
    confidence.textContent = event.actor === "model" && Number.isFinite(event.probability)
      ? formatPercent(event.probability)
      : `#${event.index}`;
    row.append(actor, action, confidence);
    elements.actionLog.appendChild(row);
  });
}

function actionEventLabel(event, includeActor = true) {
  const actor = event.actor === "human" ? "你" : "模型";
  const action = ACTION_LABELS[event.action_family] || event.action_family;
  const tile = event.tile_id == null ? "" : tileMeta(event.tile_id).label;
  return `${includeActor ? `${actor} ` : ""}${action}${tile ? ` ${tile}` : ""}`;
}

function maybeShowResult(game) {
  if (!game.terminal || !game.settlement) return;
  const key = `${game.session_id}:${game.hand_number}`;
  if (state.shownResultKey === key) return;
  state.shownResultKey = key;
  const settlement = game.settlement;
  const score = settlement.raw_score_by_player[0];
  let title = "本局流局";
  if (settlement.winner_player_id === 0) title = "你胡了";
  if (settlement.winner_player_id === 1) title = "模型胡了";
  if (game.match.match_complete) {
    elements.resultKicker.textContent = `${game.match.target_hands} 局比赛完成`;
    elements.resultTitle.textContent = game.match.score_margin > 0
      ? "你赢得本轮比赛"
      : game.match.score_margin < 0
      ? "模型赢得本轮比赛"
      : "本轮比赛平分";
    elements.resultSummary.textContent = `总比分 ${formatSigned(game.match.human_score)} : ${formatSigned(game.match.model_score)} · 胡牌 ${game.match.human_hu_wins} : ${game.match.model_hu_wins}`;
  } else {
    elements.resultKicker.textContent = TERMINAL_LABELS[game.terminal_reason] || "本局结束";
    elements.resultTitle.textContent = title;
    elements.resultSummary.textContent = settlement.winner_player_id == null
      ? `流局结算，你的本局得分 ${formatSigned(score)}`
      : `${WIN_SOURCE_LABELS[settlement.win_source] || "胡牌"} · ${settlement.total_additive_fan} 番 · 本局 ${formatSigned(score)}`;
  }
  renderFanDetails(settlement);
  elements.dialogNextHandButton.hidden = game.match.match_complete;
  elements.dialogNextHandButton.disabled = game.match.match_complete;
  if (!elements.resultDialog.open) elements.resultDialog.showModal();
}

function renderFanDetails(settlement) {
  elements.fanDetails.replaceChildren();
  const entries = Object.entries(settlement.fan_details || {});
  if (!entries.length) {
    appendDefinition(elements.fanDetails, "结算类型", TERMINAL_LABELS[settlement.terminal_reason] || "流局");
  } else {
    entries.forEach(([name, fan]) => appendDefinition(
      elements.fanDetails,
      FAN_LABELS[name.toLowerCase()] || name,
      `${fan} 番`
    ));
  }
  appendDefinition(elements.fanDetails, "总番数", `${settlement.total_additive_fan} 番`);
  appendDefinition(elements.fanDetails, "本局得分", formatSigned(settlement.raw_score_by_player[0]));
}

function appendDefinition(container, term, value) {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = value;
  row.append(dt, dd);
  container.appendChild(row);
}

function drawSourceLabel(player) {
  if (player.current_draw_tile == null) return "";
  if (player.after_gang_draw || player.last_draw_source === "TAIL") return "杠后补牌";
  return "本轮摸牌";
}

function meldLabel(type) {
  return ({ PENG: "碰", MING_GANG: "明杠", AN_GANG: "暗杠", BU_GANG: "补杠" })[type] || type;
}

function syncPreferenceControls() {
  if (FAIR_TEST_MODE) {
    state.showModelHand = false;
    state.showRecommendationProbabilities = false;
  }
  elements.modelHandToggle.checked = state.showModelHand;
  elements.recommendationProbabilityToggle.checked = state.showRecommendationProbabilities;
  document.body.classList.toggle(
    "hide-recommendation-probabilities",
    !state.showRecommendationProbabilities
  );
  matchLengthButtons.forEach((button) => {
    const active = Number(button.dataset.matchLength) === state.matchLength;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setControlsDisabled(disabled) {
  elements.newMatchButton.disabled = disabled;
  const cannotAdvance = !state.game || !state.game.terminal || state.game.match.match_complete;
  elements.nextHandButton.disabled = disabled || cannotAdvance;
  elements.dialogNextHandButton.disabled = disabled || cannotAdvance;
  elements.exportCsvButton.disabled = disabled || !state.game?.match.hand_records.length;
  elements.exportJsonButton.disabled = disabled || !state.game;
  const noHistory = !state.history?.total_hands;
  elements.historyExportCsvButton.disabled = disabled || noHistory;
  elements.historyExportJsonButton.disabled = disabled || noHistory;
  matchLengthButtons.forEach((button) => { button.disabled = disabled; });
  document.querySelectorAll("button.tile, .action-button").forEach((button) => {
    button.disabled = disabled;
  });
  elements.confirmDiscardButton.disabled = disabled || !selectedDiscardAction();
}

function exportJson() {
  if (!state.game) return;
  const payload = {
    exported_at: new Date().toISOString(),
    model: state.game.model,
    session_id: state.game.session_id,
    base_seed: state.game.match.hand_records[0]?.seed ?? state.game.seed,
    match: state.game.match,
  };
  downloadBlob(
    JSON.stringify(payload, null, 2),
    `nanchong_linear_danger_${state.game.match.target_hands}games_${state.game.session_id.slice(0, 8)}.json`,
    "application/json;charset=utf-8"
  );
}

function exportCsv() {
  const records = state.game?.match.hand_records || [];
  if (!records.length) return;
  const columns = [
    "hand_number", "seed", "human_first_seat", "winner", "terminal_reason",
    "human_score", "model_score", "additive_fan", "end_round",
    "human_first_tenpai_round", "model_first_tenpai_round", "decisions", "discards",
    "pengs", "ming_kongs", "concealed_kongs", "added_kongs",
  ];
  const rows = [columns.join(",")];
  records.forEach((record) => {
    rows.push(columns.map((column) => csvCell(record[column])).join(","));
  });
  downloadBlob(
    `\ufeff${rows.join("\r\n")}`,
    `nanchong_linear_danger_${state.game.match.target_hands}games_${state.game.session_id.slice(0, 8)}.csv`,
    "text/csv;charset=utf-8"
  );
}

async function exportHistoryJson() {
  await withPending("正在导出全部历史", async () => {
    const payload = await api("/api/history/export");
    downloadBlob(
      JSON.stringify(payload, null, 2),
      `nanchong_linear_danger_all_history_${historyExportDate()}.json`,
      "application/json;charset=utf-8"
    );
  });
}

async function exportHistoryCsv() {
  await withPending("正在导出全部历史", async () => {
    const payload = await api("/api/history/export");
    const records = payload.hands || [];
    const columns = [
      "history_id", "recorded_at", "session_id", "hand_number", "seed",
      "human_first_seat", "winner", "terminal_reason", "human_score", "model_score",
      "additive_fan", "total_score", "end_round", "human_first_tenpai_round",
      "model_first_tenpai_round", "decisions", "discards", "pengs", "ming_kongs",
      "concealed_kongs", "added_kongs",
    ];
    const rows = [columns.join(",")];
    records.forEach((record) => {
      rows.push(columns.map((column) => csvCell(record[column])).join(","));
    });
    downloadBlob(
      `\ufeff${rows.join("\r\n")}`,
      `nanchong_linear_danger_all_history_${historyExportDate()}.csv`,
      "text/csv;charset=utf-8"
    );
  });
}

async function exportParticipantStatistics() {
  if (FAIR_TEST_MODE) return;
  await withPending("正在导出测试人员统计", async () => {
    const payload = await api("/api/history/participants/export");
    downloadBlob(
      JSON.stringify(payload, null, 2),
      `nanchong_test_participants_${historyExportDate()}.json`,
      "application/json;charset=utf-8"
    );
  });
}

function historyExportDate() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function csvCell(value) {
  if (value == null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadBlob(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function setError(message) {
  elements.errorBanner.hidden = !message;
  elements.errorBanner.textContent = message;
}

function closeResultDialog() {
  if (elements.resultDialog.open) elements.resultDialog.close();
}

function formatPercent(value) {
  return value == null ? "0.0%" : `${(Number(value) * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function formatNullableNumber(value, suffix) {
  return value == null ? "--" : `${Number(value).toFixed(2)}${suffix}`;
}

function formatSigned(value) {
  const number = Number(value);
  return number > 0 ? `+${number}` : String(number);
}

function formatCompactGames(value) {
  const number = Number(value);
  return number >= 10000 ? `${(number / 10000).toFixed(1)}万` : String(number);
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}

elements.newMatchButton.addEventListener("click", newMatch);
elements.nextHandButton.addEventListener("click", nextHand);
elements.confirmDiscardButton.addEventListener("click", confirmSelectedDiscard);
elements.dialogNextHandButton.addEventListener("click", nextHand);
elements.dialogCloseButton.addEventListener("click", closeResultDialog);
elements.exportCsvButton.addEventListener("click", exportCsv);
elements.exportJsonButton.addEventListener("click", exportJson);
elements.historyExportCsvButton.addEventListener("click", exportHistoryCsv);
elements.historyExportJsonButton.addEventListener("click", exportHistoryJson);
elements.participantExportJsonButton.addEventListener("click", exportParticipantStatistics);
elements.modelHandToggle.addEventListener("change", () => {
  if (FAIR_TEST_MODE) return;
  state.showModelHand = elements.modelHandToggle.checked;
  localStorage.setItem(STORAGE_REVEAL, String(state.showModelHand));
  render();
});
elements.recommendationProbabilityToggle.addEventListener("change", () => {
  if (FAIR_TEST_MODE) return;
  state.showRecommendationProbabilities = elements.recommendationProbabilityToggle.checked;
  localStorage.setItem(
    STORAGE_RECOMMENDATION_PROBABILITIES,
    String(state.showRecommendationProbabilities)
  );
  render();
});
matchLengthButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.matchLength = Number(button.dataset.matchLength) === 20 ? 20 : 10;
    localStorage.setItem(STORAGE_MATCH_LENGTH, String(state.matchLength));
    syncPreferenceControls();
  });
});

async function boot() {
  applyRuntimeMode();
  removeInviteTokenFromAddressBar();
  try {
    await ensureParticipant();
    await withPending("正在载入 Linear-Danger 模型", restoreOrNewMatch, true);
    scheduleTileFacePreload();
  } catch (error) {
    elements.loadingLayer.hidden = true;
    setError(error instanceof Error ? error.message : String(error));
  }
}

boot();
