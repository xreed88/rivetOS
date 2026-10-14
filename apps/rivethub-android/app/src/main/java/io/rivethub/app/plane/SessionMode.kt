package io.rivethub.app.plane

enum class SessionMode { Chat, Terminal }

const val MODE_CHAT = "chat"
const val MODE_TERMINAL = "terminal"

fun parseSessionMode(raw: String?): SessionMode =
    if (raw?.trim()?.lowercase() == MODE_TERMINAL) SessionMode.Terminal else SessionMode.Chat

fun persistSessionMode(mode: SessionMode): String = when (mode) {
    SessionMode.Chat -> MODE_CHAT
    SessionMode.Terminal -> MODE_TERMINAL
}

/**
 * After adopt/rekey, copy the mode from the retired id onto the canonical
 * one. The canonical entry wins if both exist.
 */
fun rekeySessionModes(
    modes: Map<String, String>,
    from: String,
    to: String,
): Map<String, String> {
    if (from.isEmpty() || from == to) return modes
    val moved = modes[from] ?: return modes
    if (modes[to] != null) return modes - from
    return modes - from + (to to moved)
}

/**
 * Whether a session with no explicit view choice opens on Terminal — twin of
 * rivethub-web `lib/harness-chat.ts sessionOpensOnTerminal` (#801). Only a
 * legacy (TUI) row can: when its roster command has no registered harness
 * driver there is no chat surface to land on. [registeredCommands] is the
 * roster commands of the node's registered harnesses, or null when the
 * registry failed to load (legacy rows then keep the terminal fallback).
 * Drafts and control-plane rows always open on Chat.
 */
fun sessionOpensOnTerminal(
    legacy: Boolean,
    command: String?,
    registeredCommands: Set<String>?,
): Boolean {
    if (!legacy) return false
    if (registeredCommands == null) return true
    val cmd = command?.trim()?.takeIf { it.isNotEmpty() } ?: return true
    return cmd !in registeredCommands
}

/** A row is legacy when the hub said so, or its key is a bare (non-canonical, non-draft) id. */
fun isLegacySessionKey(flagged: Boolean, draft: Boolean, sessionKey: String): Boolean =
    flagged || (!draft && sessionKey.isNotBlank() && ':' !in sessionKey)
