require_relative 'test_helper'

class AppTest < Minitest::Test
  include Rack::Test::Methods

  def app
    MagicLogin::App
  end

  def setup
    clear_cookies
    @store = MagicLogin::Store.new(':memory:')
    @mailer = RecordingMailer.new
    app.set :store, @store
    app.set :mailer, @mailer
  end

  def csrf
    last_response.body[/name="csrf_token" value="([^"]+)"/, 1]
  end

  def request_link(email = 'person@example.com')
    get '/'
    post '/auth/email/request', email: email, csrf_token: csrf
    assert_equal 303, last_response.status
    @mailer.deliveries.last.last
  end

  def test_full_login_and_logout_in_another_browser
    token = request_link('Person@Example.com')
    refute_includes last_response.body, token
    clear_cookies # The mail link can open in a different browser.
    get '/login', token: token
    assert_equal 303, last_response.status
    assert_equal 'no-referrer', last_response.headers['referrer-policy']
    refute_includes last_response.headers['location'], token
    follow_redirect!
    assert_includes last_response.body, 'Confirma tu acceso'
    old_csrf = csrf
    post '/auth/email/confirm', csrf_token: old_csrf
    assert_equal 303, last_response.status
    follow_redirect!
    assert_includes last_response.body, 'person@example.com'
    assert_includes last_response.body, 'Ya estás dentro'
    refute_equal old_csrf, csrf
    assert_match(/httponly/i, last_response.headers['set-cookie'].to_s)
    post '/logout', csrf_token: csrf
    follow_redirect!
    assert_includes last_response.body, 'Entra con tu correo'
  end

  def test_a_link_cannot_be_replayed
    token = request_link
    2.times do |attempt|
      get '/login', token: token
      follow_redirect!
      post '/auth/email/confirm', csrf_token: csrf
      assert_equal(attempt.zero? ? 303 : 422, last_response.status)
    end
  end

  def test_get_requests_do_not_consume_links
    token = request_link
    2.times do
      get '/login', token: token
      follow_redirect!
      assert_equal 200, last_response.status
    end
    clear_cookies
    get '/'
    refute_includes last_response.body, 'Ya estás dentro'
    get '/login', token: token
    follow_redirect!
    post '/auth/email/confirm', csrf_token: csrf
    assert_equal 303, last_response.status
  end

  def test_request_requires_csrf
    post '/auth/email/request', email: 'person@example.com'
    assert_equal 403, last_response.status
    assert_empty @mailer.deliveries
  end

  def test_confirmation_requires_csrf_and_a_real_link
    request_link
    post '/auth/email/confirm'
    assert_equal 403, last_response.status
    get '/'
    post '/auth/email/confirm', csrf_token: csrf
    assert_equal 422, last_response.status
  end

  def test_invalid_email_does_not_send_mail
    get '/'
    post '/auth/email/request', email: "bad@example.com\r\nBcc: victim@example.com", csrf_token: csrf
    assert_equal 422, last_response.status
    assert_empty @mailer.deliveries
  end

  def test_sending_is_rate_limited
    request_link
    get '/'
    post '/auth/email/request', email: 'person@example.com', csrf_token: csrf
    assert_equal 429, last_response.status
    assert_equal 1, @mailer.deliveries.length
  end

  def test_delivery_failure_does_not_create_a_working_link
    @mailer.failure = MagicLogin::DeliveryError.new
    get '/'
    post '/auth/email/request', email: 'person@example.com', csrf_token: csrf
    assert_equal 502, last_response.status
    refute_includes last_response.body, 'Revisa tu correo'
  end

  def test_missing_configuration_is_reported
    @mailer.failure = MagicLogin::ConfigurationError.new
    get '/'
    post '/auth/email/request', email: 'person@example.com', csrf_token: csrf
    assert_equal 503, last_response.status
  end

  def test_malformed_and_unknown_links_cannot_authenticate
    get '/login', token: '<script>alert(1)</script>'
    assert_equal 422, last_response.status
    refute_includes last_response.body, '<script>'
    get '/login', token: 'a' * 64
    follow_redirect!
    post '/auth/email/confirm', csrf_token: csrf
    assert_equal 422, last_response.status
  end
end
