#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build
swiftc -O -parse-as-library native/Perception.swift -o .build/jev-native
swiftc -O native/Fixture.swift -o .build/jev-fixture
swiftc -O native/VerifyCalculator.swift -o .build/verify-calculator
# A named app bundle lets window recorders and accessibility tools identify the demo.
mkdir -p '.build/Jev Loop Lab.app/Contents/MacOS'
cp .build/jev-fixture '.build/Jev Loop Lab.app/Contents/MacOS/JevLoopLab'
cp native/FixtureInfo.plist '.build/Jev Loop Lab.app/Contents/Info.plist'
