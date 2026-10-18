require 'net/http'
require 'json'
require 'uri'
require 'time'
require 'fileutils'
require 'securerandom'

module MagicLogin
  class DeliveryError < StandardError; end
  class ConfigurationError < DeliveryError; end

  class Mailer
    EMAIL_PATTERN = /\A[A-Za-z0-9.!\#$%&'*+\/=\?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}\z/

    def initialize(env: ENV, root: File.expand_path('..', __dir__), http: Net::HTTP)
      @env, @root, @http = env, root, http
    end

    def deliver_link(email, token)
      base = @env.fetch('APP_BASE_URL', 'http://localhost:9292')
      uri = URI.parse(base)
      production = @env['RACK_ENV'] == 'production'
      unless %w[http https].include?(uri.scheme) && uri.host && !uri.userinfo && !uri.query && !uri.fragment &&
             ['', '/'].include?(uri.path) && (!production || uri.scheme == 'https')
        raise ConfigurationError
      end
      raise ConfigurationError unless email.match?(EMAIL_PATTERN)
      link = "#{base.delete_suffix('/')}/login?token=#{token}"
      from = @env.fetch('MAIL_FROM', 'login@example.test')
      raise ConfigurationError unless from.match?(EMAIL_PATTERN)

      message = <<~MAIL.gsub("\n", "\r\n")
        From: #{from}
        To: #{email}
        Subject: Tu enlace de acceso
        Date: #{Time.now.rfc2822}
        Message-ID: <#{SecureRandom.hex(16)}@#{from.split('@').last}>
        MIME-Version: 1.0
        Content-Type: text/plain; charset=UTF-8
        Content-Transfer-Encoding: 8bit

        Abre este enlace y confirma para iniciar sesion:

        #{link}

        Vence en 15 minutos y solo puede usarse una vez.
        Si no solicitaste este acceso, ignora este correo.
      MAIL

      if @env['MAIL_DELIVERY'] == 'file'
        raise ConfigurationError if production
        directory = File.join(@root, 'var', 'mail')
        FileUtils.mkdir_p(directory, mode: 0o700)
        path = File.join(directory, "#{SecureRandom.hex(16)}.eml")
        File.open(path, File::WRONLY | File::CREAT | File::EXCL, 0o600) { |file| file.write(message) }
        return
      end

      key = @env['RESEND_API_KEY']
      raise ConfigurationError if key.to_s.empty? || !@env.key?('MAIL_FROM')
      request = Net::HTTP::Post.new('/emails')
      request['Authorization'] = "Bearer #{key}"
      request['Content-Type'] = 'application/json'
      request.body = JSON.generate(from: from, to: [email], subject: 'Tu enlace de acceso', text: message.split("\r\n\r\n", 2).last)
      response = @http.start('api.resend.com', 443, use_ssl: true, open_timeout: 5, read_timeout: 10, write_timeout: 10) do |connection|
        connection.request(request)
      end
      raise DeliveryError unless response.is_a?(Net::HTTPSuccess)
    rescue URI::InvalidURIError, ArgumentError
      raise ConfigurationError
    rescue IOError, SystemCallError, Timeout::Error, OpenSSL::SSL::SSLError
      raise DeliveryError
    end
  end
end
