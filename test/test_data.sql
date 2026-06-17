-- API keys store the SHA-256 hash of the plaintext key, never the key itself.
-- Plaintext sk-usera123 -> hash below; plaintext sk-userb456 -> hash below.
INSERT INTO api_keys (key_value, email, created_at) VALUES ('7cf6a1765aac99f3c6ed31e61c24c2d064d45ca448d430b4f5b6351f29bdcb10', 'usera@example.com', 1718600000);
INSERT INTO api_keys (key_value, email, created_at) VALUES ('8ff38981fb3ad224083548ae0578afadd783baa0bc1104faddd67e63c8b4aeee', 'userb@example.com', 1718600000);

-- Email 1 to usera@example.com
INSERT INTO emails (id, msg_id, from_addr, from_name, to_addr, cc_addr, subject, date, text_body, raw_key, size, has_attachments, received_at)
VALUES ('email-1', '<msg-1@example.com>', 'sender@example.com', 'Sender', 'usera@example.com', NULL, 'Hello User A', 1718600000, 'This is a secret email for A.', 'raw/email-1.eml', 100, 0, 1718600000);

-- Email 2 to userb@example.com
INSERT INTO emails (id, msg_id, from_addr, from_name, to_addr, cc_addr, subject, date, text_body, raw_key, size, has_attachments, received_at)
VALUES ('email-2', '<msg-2@example.com>', 'sender@example.com', 'Sender', 'userb@example.com', NULL, 'Hello User B', 1718600000, 'This is a secret email for B.', 'raw/email-2.eml', 100, 0, 1718600000);

-- Email 3 CC to usera@example.com
INSERT INTO emails (id, msg_id, from_addr, from_name, to_addr, cc_addr, subject, date, text_body, raw_key, size, has_attachments, received_at)
VALUES ('email-3', '<msg-3@example.com>', 'sender@example.com', 'Sender', 'other@example.com', 'usera@example.com', 'Hello CC A', 1718600000, 'This is a CC email for A.', 'raw/email-3.eml', 100, 0, 1718600000);

-- Email 4: addressed to xusera@example.com. usera@example.com must NOT see this
-- (guards against substring-match leakage).
INSERT INTO emails (id, msg_id, from_addr, from_name, to_addr, cc_addr, subject, date, text_body, raw_key, size, has_attachments, received_at)
VALUES ('email-4', '<msg-4@example.com>', 'sender@example.com', 'Sender', 'xusera@example.com', NULL, 'Not for A', 1718600000, 'This must never leak to usera.', 'raw/email-4.eml', 100, 0, 1718600000);
