/**
 * 把一个会话索引项读成事件流（turns + compaction）。
 */
import { getAgent } from "./registry.mjs";

export async function loadSession(session) {
  const agent = getAgent(session.agent);
  if (!agent) throw new Error(`不支持的会话来源：${session.agent}`);
  const { turns, compaction } = await agent.parse(session.files);
  return { ...session, turns, compaction };
}
