require 'sqlite3'
require 'securerandom'
require 'digest'
require 'fileutils'

module MagicLogin
  class RateLimited < StandardError; end
  class InvalidLink < StandardError; end

  class Store
    TTL = 900

    def initialize(path)
      FileUtils.mkdir_p(File.dirname(path), mode: 0o700) unless path == ':memory:'
      @db = SQLite3::Database.new(path)
      @db.busy_timeout = 5000
      @mutex = Mutex.new
      @db.execute_batch(<<~SQL)
        CREATE TABLE IF NOT EXISTS login_links (
          token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, ip_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX IF NOT EXISTS link_email_time ON login_links(email, created_at);
        CREATE INDEX IF NOT EXISTS link_ip_time ON login_links(ip_hash, created_at);
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE);
      SQL
    end

    def create_link(email, ip, now: Time.now.to_i)
      transaction do
        @db.execute('DELETE FROM login_links WHERE created_at < ?', [now - 86_400])
        ip_hash = Digest::SHA256.hexdigest(ip)
        recent = @db.get_first_value('SELECT COUNT(*) FROM login_links WHERE email = ? AND created_at > ?', [email, now - 900])
        ip_recent = @db.get_first_value('SELECT COUNT(*) FROM login_links WHERE ip_hash = ? AND created_at > ?', [ip_hash, now - 900])
        last = @db.get_first_value('SELECT MAX(created_at) FROM login_links WHERE email = ?', [email])
        raise RateLimited if recent >= 3 || ip_recent >= 20 || (last && now - last < 60)

        token = SecureRandom.hex(32)
        @db.execute('INSERT INTO login_links (token_hash, email, ip_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [digest(token), email, ip_hash, now, now + TTL])
        token
      end
    end

    def fail_delivery(token)
      transaction { @db.execute("UPDATE login_links SET state = 'failed' WHERE token_hash = ?", [digest(token)]) }
    end

    def consume_link(token, now: Time.now.to_i)
      raise InvalidLink unless token.is_a?(String) && token.match?(/\A[0-9a-f]{64}\z/)

      transaction do
        email = @db.get_first_value("SELECT email FROM login_links WHERE token_hash = ? AND state = 'pending' AND expires_at > ?", [digest(token), now])
        raise InvalidLink unless email

        @db.execute("UPDATE login_links SET state = 'used' WHERE token_hash = ?", [digest(token)])
        @db.execute("UPDATE login_links SET state = 'used' WHERE email = ? AND state = 'pending'", [email])
        @db.execute('INSERT OR IGNORE INTO users (email) VALUES (?)', [email])
        @db.get_first_value('SELECT id FROM users WHERE email = ?', [email])
      end
    end

    def link_email(token, now: Time.now.to_i)
      return unless token.is_a?(String) && token.match?(/\A[0-9a-f]{64}\z/)
      transaction do
        @db.get_first_value("SELECT email FROM login_links WHERE token_hash = ? AND state = 'pending' AND expires_at > ?", [digest(token), now])
      end
    end

    def user_email(id)
      transaction { @db.get_first_value('SELECT email FROM users WHERE id = ?', [id]) }
    end

    private

    def digest(token)
      Digest::SHA256.hexdigest(token)
    end

    def transaction(&block)
      @mutex.synchronize { @db.transaction(:immediate, &block) }
    end
  end
end
