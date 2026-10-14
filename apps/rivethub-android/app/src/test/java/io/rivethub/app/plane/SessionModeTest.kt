package io.rivethub.app.plane

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class SessionModeTest {
    @Test fun `blank and unknown persist as Chat`() {
        assertEquals(SessionMode.Chat, parseSessionMode(null))
        assertEquals(SessionMode.Chat, parseSessionMode(""))
        assertEquals(SessionMode.Chat, parseSessionMode("den"))
        assertEquals(SessionMode.Chat, parseSessionMode("CHAT"))
    }

    @Test fun `terminal is case-insensitive`() {
        assertEquals(SessionMode.Terminal, parseSessionMode("terminal"))
        assertEquals(SessionMode.Terminal, parseSessionMode(" Terminal "))
    }

    @Test fun `persist round-trips`() {
        assertEquals(MODE_CHAT, persistSessionMode(SessionMode.Chat))
        assertEquals(MODE_TERMINAL, persistSessionMode(SessionMode.Terminal))
        assertEquals(SessionMode.Terminal, parseSessionMode(persistSessionMode(SessionMode.Terminal)))
    }

    @Test fun `rekey copies the mode onto the canonical id`() {
        val next = rekeySessionModes(mapOf("draft" to MODE_TERMINAL), "draft", "claude-code:draft")
        assertEquals(MODE_TERMINAL, next["claude-code:draft"])
        assertEquals(null, next["draft"])
    }

    @Test fun `rekey does not overwrite an existing canonical mode`() {
        val modes = mapOf("draft" to MODE_TERMINAL, "claude-code:draft" to MODE_CHAT)
        val next = rekeySessionModes(modes, "draft", "claude-code:draft")
        assertEquals(MODE_CHAT, next["claude-code:draft"])
        assertEquals(null, next["draft"])
    }

    @Test fun `rekey no-op on empty or identical ids`() {
        val modes = mapOf("a" to MODE_CHAT)
        assertSame(modes, rekeySessionModes(modes, "", "b"))
        assertSame(modes, rekeySessionModes(modes, "a", "a"))
    }

    @Test fun `control-plane rows and drafts never open on Terminal`() {
        assertEquals(false, sessionOpensOnTerminal(legacy = false, command = null, registeredCommands = null))
        assertEquals(false, sessionOpensOnTerminal(legacy = false, command = "bash", registeredCommands = setOf("claude")))
    }

    @Test fun `legacy row with a registered roster command opens on Chat`() {
        assertEquals(false, sessionOpensOnTerminal(legacy = true, command = "claude", registeredCommands = setOf("claude", "codex")))
    }

    @Test fun `legacy TUI-only row opens on Terminal`() {
        assertEquals(true, sessionOpensOnTerminal(legacy = true, command = "bash", registeredCommands = setOf("claude")))
        assertEquals(true, sessionOpensOnTerminal(legacy = true, command = null, registeredCommands = setOf("claude")))
        assertEquals(true, sessionOpensOnTerminal(legacy = true, command = " ", registeredCommands = setOf("claude")))
    }

    @Test fun `legacy row keeps the terminal fallback when the registry failed`() {
        assertEquals(true, sessionOpensOnTerminal(legacy = true, command = "claude", registeredCommands = null))
    }

    @Test fun `bare non-draft keys are legacy, canonical ids and drafts are not`() {
        assertEquals(true, isLegacySessionKey(flagged = false, draft = false, sessionKey = "den-room-7"))
        assertEquals(false, isLegacySessionKey(flagged = false, draft = false, sessionKey = "codex:abc"))
        assertEquals(false, isLegacySessionKey(flagged = false, draft = true, sessionKey = "6f1c0e3a"))
        assertEquals(true, isLegacySessionKey(flagged = true, draft = false, sessionKey = "codex:abc"))
    }
}
