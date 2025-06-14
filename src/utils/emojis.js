// src/utils/emojis.js
module.exports = {
    // Australian flag emoji
    AUSTRALIA_FLAG: '<:Australia:1383289340985081920>',
    
    // Custom checkmark
    CHECK: '<:Checkmark:1383290447946059806>',
    
    // Custom X mark
    X_MARK: '<:Cross:1383290190810054747>',
    
    // Fallback to Unicode emojis if custom ones aren't available
    FALLBACK: {
        FLAG: '🇦🇺',
        CHECK: '✅',
        X_MARK: '❌'
    }
};