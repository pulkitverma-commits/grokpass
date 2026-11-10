# Local Expo module (autolinked from apps/mobile/modules by expo-modules-autolinking, default
# nativeModulesDir "./modules"). Shape follows the expo-module-template-local podspec.
Pod::Spec.new do |s|
  s.name           = 'ScreenState'
  s.version        = '1.0.0'
  s.summary        = 'OnePeek: screen-capture state and backup exclusion'
  s.description    = 'Reports UIScreen.isCaptured changes and marks the chat database as excluded from backups.'
  s.author         = ''
  s.homepage       = 'https://onepeek.io'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
