require 'sinatra/base'
require 'rack/session/cookie'
require_relative 'lib/store'
require_relative 'lib/mailer'

module MagicLogin
  class App < Sinatra::Base
    configure do
      set :root, __dir__
      set :show_exceptions, false
      # Magic links must not be written into request logs.
      set :logging, false
      set :mailer, Mailer.new
      set :store, Store.new(ENV.fetch('DATABASE_PATH', File.join(__dir__, 'var', 'login.sqlite3')))

      secret = ENV['SESSION_SECRET']
      if secret.to_s.empty?
        raise 'SESSION_SECRET must contain at least 64 characters in production' if production?
        secret_path = File.join(__dir__, 'var', 'session_secret')
        FileUtils.mkdir_p(File.dirname(secret_path), mode: 0o700)
        begin
          File.open(secret_path, File::WRONLY | File::CREAT | File::EXCL, 0o600) { |file| file.write(SecureRandom.hex(64)) }
        rescue Errno::EEXIST
          # Reuse the local development secret across restarts.
        end
        secret = File.read(secret_path)
      end
      raise 'SESSION_SECRET must contain at least 64 characters' if secret.bytesize < 64
      use Rack::Session::Cookie, key: 'magic_login', secret: secret, httponly: true,
          same_site: :lax, secure: production?, expire_after: 3600
    end

    helpers do
      def h(value)
        Rack::Utils.escape_html(value.to_s)
      end

      def csrf_token
        session[:csrf] ||= SecureRandom.hex(32)
      end

      def render_error(message, status_code)
        @error = message
        status status_code
        erb :login
      end
    end

    before do
      headers 'Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff',
              'Referrer-Policy' => 'no-referrer',
              'Content-Security-Policy' => "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      if request.post?
        expected, actual = session[:csrf], params['csrf_token']
        halt 403, 'Solicitud inválida. Recarga la página.' unless expected.is_a?(String) && actual.is_a?(String) && Rack::Utils.secure_compare(expected, actual)
      end
    end

    get '/' do
      @email = settings.store.user_email(session[:user_id]) if session[:user_id]
      erb(@email ? :account : :login)
    end

    post '/auth/email/request' do
      email = params['email'].to_s.strip.downcase
      unless email.bytesize <= 254 && email.match?(Mailer::EMAIL_PATTERN)
        return render_error('Ingresa un correo válido.', 422)
      end

      token = settings.store.create_link(email, request.ip)
      begin
        settings.mailer.deliver_link(email, token)
      rescue DeliveryError
        settings.store.fail_delivery(token)
        raise
      end
      redirect '/sent', 303
    rescue RateLimited
      headers 'Retry-After' => '900'
      render_error('Espera antes de pedir otro enlace. Máximo 3 cada 15 minutos y 1 por minuto.', 429)
    rescue ConfigurationError
      render_error('El envío de correo aún no está configurado.', 503)
    rescue DeliveryError
      render_error('No pudimos enviar el correo. Inténtalo más tarde.', 502)
    end

    get('/sent') { erb :sent }

    get '/login' do
      token = params['token']
      unless token.is_a?(String) && token.match?(/\A[0-9a-f]{64}\z/)
        return render_error('El enlace no es válido. Solicita uno nuevo.', 422)
      end
      # Reading a link never consumes it: email scanners may follow GET links.
      session[:login_token] = token
      redirect '/confirm', 303
    end

    get '/confirm' do
      redirect '/', 303 unless session[:login_token]
      @email = settings.store.link_email(session[:login_token])
      return render_error('El enlace venció o ya fue utilizado. Solicita uno nuevo.', 422) unless @email
      erb :confirm
    end

    post '/auth/email/confirm' do
      user_id = settings.store.consume_link(session[:login_token])
      session.clear
      session[:user_id] = user_id
      redirect '/', 303
    rescue InvalidLink
      session.delete(:login_token)
      render_error('El enlace venció o ya fue utilizado. Solicita uno nuevo.', 422)
    end

    post '/logout' do
      session.clear
      redirect '/', 303
    end
  end
end
