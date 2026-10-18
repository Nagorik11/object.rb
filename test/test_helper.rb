ENV['RACK_ENV'] = 'test'
ENV['DATABASE_PATH'] = ':memory:'
ENV['SESSION_SECRET'] = 'test-only-secret-' * 8
require 'minitest/autorun'
require 'rack/test'
require_relative '../app'

class RecordingMailer
  attr_reader :deliveries
  attr_accessor :failure

  def initialize
    @deliveries = []
  end

  def deliver_link(email, token)
    raise failure if failure
    @deliveries << [email, token]
  end
end
