#!/usr/bin/env node
/**
 * 兼容入口：老的 MCP 配置指向 index.mjs，保留它。
 * 真正实现在 bin/aab.mjs。
 */
import "./bin/aab.mjs";
