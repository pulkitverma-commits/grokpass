require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ShareIntent'
  s.version        = '1.0.0'
  s.summary        = 'OnePeek share-intent receiver (iOS side: stubs; the App Group reader is JS)'
  s.description    = 'Local Expo module. Android reads ACTION_SEND intents; on iOS the share extension writes to the App Group container and apps/mobile/security/appGroup.ts reads it.'
  s.author         = 'OnePeek'
  s.homepage       = 'https://onepeek.io'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
