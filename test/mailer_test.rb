require_relative 'test_helper'
require 'tmpdir'

class MailerTest < Minitest::Test
  class HttpDouble
    attr_reader :connection_options, :sent_request

    def initialize(response)
      @response = response
    end

    def start(*args, **options)
      @connection_options = [args, options]
      yield self
    end

    def request(request)
      @sent_request = request
      @response
    end
  end

  def test_file_delivery_contains_link_and_is_private
    Dir.mktmpdir do |root|
      mailer = MagicLogin::Mailer.new(env: { 'MAIL_DELIVERY' => 'file', 'APP_BASE_URL' => 'http://localhost:9292' }, root: root)
      mailer.deliver_link('person@example.com', 'a' * 64)
      files = Dir[File.join(root, 'var', 'mail', '*.eml')]
      assert_equal 1, files.length
      assert_equal 0o600, File.stat(files.first).mode & 0o777
      assert_includes File.read(files.first), "http://localhost:9292/login?token=#{'a' * 64}"
    end
  end

  def test_file_delivery_is_forbidden_in_production
    mailer = MagicLogin::Mailer.new(env: { 'RACK_ENV' => 'production', 'MAIL_DELIVERY' => 'file', 'APP_BASE_URL' => 'https://login.example.com' })
    assert_raises(MagicLogin::ConfigurationError) { mailer.deliver_link('person@example.com', 'a' * 64) }
  end

  def test_production_requires_https_and_no_url_injection
    %w[http://login.example.com https://evil@example.com https://login.example.com/?x=1].each do |base|
      mailer = MagicLogin::Mailer.new(env: { 'RACK_ENV' => 'production', 'APP_BASE_URL' => base })
      assert_raises(MagicLogin::ConfigurationError) { mailer.deliver_link('person@example.com', 'a' * 64) }
    end
  end

  def test_missing_api_key_is_configuration_error
    mailer = MagicLogin::Mailer.new(env: {})
    assert_raises(MagicLogin::ConfigurationError) { mailer.deliver_link('person@example.com', 'a' * 64) }
  end

  def test_resend_request_uses_tls_authorization_and_configured_origin
    http = HttpDouble.new(Net::HTTPOK.new('1.1', '200', 'OK'))
    mailer = MagicLogin::Mailer.new(env: {
      'RESEND_API_KEY' => 'test-only-key', 'MAIL_FROM' => 'login@example.com', 'APP_BASE_URL' => 'https://login.example.com'
    }, http: http)
    mailer.deliver_link('person@example.com', 'a' * 64)
    assert_equal ['api.resend.com', 443], http.connection_options.first
    assert_equal true, http.connection_options.last[:use_ssl]
    assert_equal 'Bearer test-only-key', http.sent_request['Authorization']
    assert_equal '/emails', http.sent_request.path
    body = JSON.parse(http.sent_request.body)
    assert_equal ['person@example.com'], body['to']
    assert_includes body['text'], "https://login.example.com/login?token=#{'a' * 64}"
  end

  def test_provider_error_is_not_success
    http = HttpDouble.new(Net::HTTPUnauthorized.new('1.1', '401', 'Unauthorized'))
    mailer = MagicLogin::Mailer.new(env: { 'RESEND_API_KEY' => 'test-only-key', 'MAIL_FROM' => 'login@example.com' }, http: http)
    assert_raises(MagicLogin::DeliveryError) { mailer.deliver_link('person@example.com', 'a' * 64) }
  end
end
