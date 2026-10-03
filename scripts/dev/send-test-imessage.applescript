on run arguments
    if (count of arguments) is not 1 then error "A single recipient is required."
    set recipientHandle to item 1 of arguments
    tell application "Messages"
        set imessageAccount to first account whose service type is iMessage and enabled is true
        if recipientHandle is "--check" then return "ready"
        set recipient to participant recipientHandle of imessageAccount
        send "Hi, how are you?" to recipient
    end tell
    return "sent"
end run
