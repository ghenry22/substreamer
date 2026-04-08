//
//  MediaURL.swift
//  RNTrackPlayer
//
//  Created by David Chavez on 12.08.17.
//  Copyright © 2017 David Chavez. All rights reserved.
//

import Foundation
import React

struct MediaURL {
    let value: URL
    let isLocal: Bool
    private let originalObject: Any
    
    init?(object: Any?) {
        guard let object = object else { return nil }
        originalObject = object

        // This is based on logic found in RCTConvert NSURLRequest,
        // and uses RCTConvert NSURL to create a valid URL from various formats.
        // U6 fix: this init is failable; return nil instead of force-casting to
        // String when the JS-supplied dict has a non-string url. Force casts
        // here previously crashed the bridge with NSException on malformed input.
        if let localObject = object as? [String: Any] {
            guard var url = (localObject["uri"] as? String) ?? (localObject["url"] as? String) else {
                return nil
            }

            if let bundleName = localObject["bundle"] as? String {
                url = String(format: "%@.bundle/%@", bundleName, url)
            }

            isLocal = url.lowercased().hasPrefix("http") ? false : true
            value = RCTConvert.nsurl(url)
        } else {
            guard let url = object as? String else {
                return nil
            }
            isLocal = url.lowercased().hasPrefix("file://")
            value = RCTConvert.nsurl(url)
        }
    }
}
