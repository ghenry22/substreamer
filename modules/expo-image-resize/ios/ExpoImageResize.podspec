require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoImageResize'
  s.version        = package['version']
  s.summary        = 'Minimal native image resize for local JPEGs'
  s.description    = 'Resizes a local JPEG to a new width on a native background thread. Bypasses Glide / expo-image-manipulator.'
  s.author         = 'Gaven Henry'
  s.homepage       = 'https://github.com/substreamer'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: 'https://github.com/substreamer/substreamer-rn.git', tag: s.version.to_s }
  s.static_framework = true
  s.license        = { :type => 'MIT' }

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
end
