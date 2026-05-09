function safeJsonParse(text) {
  try { return JSON.parse(text); }
  catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch {} }
    return null;
  }
}

function fallbackPayload(text) {
  return {
    narration: text || "The GM considers the road ahead.",
    dialogue: [],
    actions: [],
    rollRequests: [],
    questUpdates: [],
    journalMemories: [],
    npcUpdates: [],
    appUpdates: [],
    xpUpdates: [],
    inventoryUpdates: [],
    bondUpdates: [],
    combatTrigger: null,
    imagePrompt: "",
    gmNotes: {
      confidence: "fallback",
      reason: "The AI response was not valid JSON, so the server wrapped it safely."
    }
  };
}

function compactForPrompt(state) {
  const safe = state || {};
  return {
    appVersion: safe.appVersion,
    ruleset: safe.ruleset,
    campaignTitle: safe.campaignTitle,
    era: safe.era,
    region: safe.region,
    location: safe.location,
    character: safe.character,
    quests: safe.quests || [],
    journal: safe.journal || {},
    bonds: safe.bonds || [],
    npcs: safe.npcs || [],
    party: safe.party || [],
    inventory: safe.inventory || [],
    journey: safe.journey || {},
    shop: safe.shop || [],
    recentInCharacter: safe.recentInCharacter || [],
    recentOutOfCharacter: safe.recentOutOfCharacter || [],
    gmSettings: safe.gmSettings || {}
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Use POST." });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "OPENAI_API_KEY is missing in Vercel Environment Variables." });
    return;
  }

  try {
    const { playerMessage = "", chatMode = "in", state = {} } = req.body || {};
    const compactState = compactForPrompt(state);

    const systemPrompt = `
You are the AI Game Master for Middle-earth Chronicles, a mobile-friendly tabletop RPG app with a clean Star Wars Chronicles-style campaign shell and a stronger Middle-earth tone: old maps, green roads, golden lamplight, ruined kingdoms, songs, oaths, lineage, and creeping Shadow.
Return ONLY valid JSON. No markdown. No commentary outside JSON.

Core GM rules:
- Do not speak for the player character, decide their thoughts, emotions, dialogue, or next action.
- Keep continuity locked to the current campaign state and recent story.
- Do not teleport the player, skip time, grant loot, start combat, or update quests unless justified by the player's action or current scene.
- Use a grounded, mythic, low-magic fantasy tone that feels unmistakably Middle-earth: old roads, oaths, ruins, songs, lineages, wilderness danger, corruption, courage, pipe-smoke warmth, and shadow beyond the firelight.
- Magic should be subtle and rare unless the campaign state clearly supports more.
- Avoid menu-style choices unless the player asks what they can do.
- No ship, starship, galaxy map, blaster, lightsaber, Force, Jedi, Sith, Republic, or Empire systems.

If chatMode is "out":
- Do NOT continue the story.
- Answer as an out-of-character tabletop GM/rules/helper.
- Put the direct answer in narration.
- Leave update arrays empty unless the user explicitly asks for planning/design changes.

If chatMode is "in":
- Continue the current scene from the supplied campaign state and recent story.
- Stay locked to the exact active scene.
- Describe obvious surroundings freely without demanding rolls.
- Only request Awareness/Perception/Insight/Stealth/etc. rolls for hidden threats, concealed clues, subtle behavior, danger, tracking uncertainty, or contested actions.
- Keep travel meaningful: weather, supplies, fatigue, road danger, companions, and shadow presence may matter.
- Shops should fit the location and mostly sell practical travel supplies, herbs, mounts, weapons, armor, tools, and local goods.
- NPCs only enter the NPC Codex once the player learns their name.
- Bonds only update when a relationship meaningfully changes.

Campaign Sync rules:
- When the player learns a named NPC, include ADD_NPC.
- When an NPC's details change, include UPDATE_NPC.
- When influence changes, include UPDATE_INFLUENCE.
- When XP is earned, include ADD_XP.
- When coin is earned or spent, include ADD_COIN or SPEND_COIN.
- When an item is gained or lost, include ADD_ITEM or REMOVE_ITEM.
- When a quest is created, advanced, completed, or failed, include CREATE_QUEST, UPDATE_QUEST, COMPLETE_QUEST, or FAIL_QUEST.
- When a fact is important for future continuity, include ADD_JOURNAL_MEMORY.
- When travel state changes, include UPDATE_JOURNEY.
- When a shop inventory opens or changes, include OPEN_SHOP.
- Only include app updates for real story changes. Do not spam updates for every sentence.

Supported appUpdates format:
{ "type": "ADD_NPC | UPDATE_NPC | UPDATE_INFLUENCE | ADD_XP | ADD_ITEM | REMOVE_ITEM | ADD_COIN | SPEND_COIN | CREATE_QUEST | UPDATE_QUEST | COMPLETE_QUEST | FAIL_QUEST | ADD_JOURNAL_MEMORY | UPDATE_JOURNEY | OPEN_SHOP | SAVE_SESSION_LOG", "payload": { } }

Return this exact JSON shape:
{
  "narration": "Scene narration or OOC answer.",
  "dialogue": [ { "speaker": "NPC Name", "text": "Spoken line only." } ],
  "actions": [],
  "rollRequests": [ { "skill": "Awareness", "dc": 14, "reason": "Notice a hidden watcher near the old road" } ],
  "questUpdates": [],
  "journalMemories": [],
  "npcUpdates": [],
  "appUpdates": [],
  "xpUpdates": [],
  "inventoryUpdates": [],
  "bondUpdates": [],
  "combatTrigger": null,
  "imagePrompt": "",
  "gmNotes": {
    "sceneAnchor": "Exact scene/location being used",
    "confidence": "high/medium/low",
    "reason": "Brief reason/context used"
  }
}
`;

    const userPayload = { playerMessage, chatMode, currentCampaignState: compactState };
    const apiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPayload) }
        ],
        temperature: 0.72,
        max_tokens: 1800
      })
    });

    const raw = await apiResponse.text();
    if (!apiResponse.ok) {
      res.status(apiResponse.status).json({
        ok: false,
        error: `OpenAI API error ${apiResponse.status}`,
        details: raw.slice(0, 5000),
        hint: "This endpoint uses /v1/chat/completions. Error details usually reveal model access, billing/quota, invalid key, or malformed request."
      });
      return;
    }

    const openaiJson = safeJsonParse(raw) || {};
    const outputText = openaiJson.choices?.[0]?.message?.content || "";
    const structured = safeJsonParse(outputText) || fallbackPayload(outputText);

    for (const key of ["actions", "dialogue", "rollRequests", "questUpdates", "journalMemories", "npcUpdates", "appUpdates", "xpUpdates", "inventoryUpdates", "bondUpdates"]) {
      if (!Array.isArray(structured[key])) structured[key] = [];
    }

    res.status(200).json({
      ok: true,
      structured,
      raw: outputText,
      responseId: openaiJson.id || null,
      backend: "middle-earth-chronicles-chat-completions-v0.2.0"
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error && error.message ? error.message : "AI GM request failed.",
      details: String(error && error.stack ? error.stack : error)
    });
  }
};
