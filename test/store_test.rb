require_relative 'test_helper'
require 'tmpdir'

class StoreTest < Minitest::Test
  def setup
    @store = MagicLogin::Store.new(':memory:')
  end

  def test_link_expires_at_fifteen_minutes
    token = @store.create_link('one@example.com', '127.0.0.1', now: 1000)
    assert_raises(MagicLogin::InvalidLink) { @store.consume_link(token, now: 1900) }
  end

  def test_tokens_are_unique_and_only_the_digest_is_saved
    Dir.mktmpdir do |directory|
      path = File.join(directory, 'login.sqlite3')
      store = MagicLogin::Store.new(path)
      token = store.create_link('one@example.com', '127.0.0.1', now: 1000)
      assert_match(/\A[0-9a-f]{64}\z/, token)
      refute_includes File.binread(path), token
      # Persistence survives another store instance.
      restored = MagicLogin::Store.new(path)
      assert_equal 'one@example.com', restored.user_email(restored.consume_link(token, now: 1001))
    end
  end

  def test_success_invalidates_other_outstanding_links
    old = @store.create_link('one@example.com', '127.0.0.1', now: 1000)
    current = @store.create_link('one@example.com', '127.0.0.1', now: 1060)
    id = @store.consume_link(current, now: 1061)
    assert_equal 'one@example.com', @store.user_email(id)
    assert_raises(MagicLogin::InvalidLink) { @store.consume_link(old, now: 1062) }
  end

  def test_email_limit_and_recovery
    [1000, 1060, 1120].each { |now| @store.create_link('one@example.com', '127.0.0.1', now: now) }
    assert_raises(MagicLogin::RateLimited) { @store.create_link('one@example.com', '127.0.0.2', now: 1180) }
    assert @store.create_link('one@example.com', '127.0.0.1', now: 1901)
  end

  def test_ip_limit_applies_across_emails
    20.times { |i| @store.create_link("person#{i}@example.com", '127.0.0.1', now: 1000) }
    assert_raises(MagicLogin::RateLimited) { @store.create_link('another@example.com', '127.0.0.1', now: 1001) }
  end

  def test_failed_delivery_invalidates_token
    token = @store.create_link('one@example.com', '127.0.0.1', now: 1000)
    @store.fail_delivery(token)
    assert_raises(MagicLogin::InvalidLink) { @store.consume_link(token, now: 1001) }
  end

  def test_parallel_consumption_only_succeeds_once
    token = @store.create_link('one@example.com', '127.0.0.1', now: 1000)
    results = 5.times.map do
      Thread.new do
        @store.consume_link(token, now: 1001)
      rescue MagicLogin::InvalidLink
        nil
      end
    end.map(&:value)
    assert_equal 1, results.compact.length
  end
end
