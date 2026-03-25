package daemon

import (
	"testing"
	"time"
)

func TestCronMatches(t *testing.T) {
	// 2026-03-25 04:00:00 is a Wednesday (weekday=3)
	ts := time.Date(2026, 3, 25, 4, 0, 0, 0, time.UTC)

	tests := []struct {
		expr string
		want bool
	}{
		{"0 4 * * *", true},        // daily at 4:00 AM
		{"0 4 25 * *", true},       // 25th at 4:00 AM
		{"0 3 * * *", false},       // daily at 3:00 AM
		{"*/15 * * * *", true},     // every 15 minutes (0 matches)
		{"5 * * * *", false},       // at :05 past every hour
		{"0 2 * * 0", false},       // Sundays at 2:00 AM (today is Wed)
		{"0 4 * * 3", true},        // Wednesdays at 4:00 AM
		{"0 4 * * 1,3,5", true},    // Mon,Wed,Fri at 4:00 AM
		{"0 4 * * 1,2", false},     // Mon,Tue at 4:00 AM
		{"0 4 * 3 *", true},        // March at 4:00 AM
		{"0 4 * 4 *", false},       // April at 4:00 AM
		{"0 2-6 * * *", true},      // hours 2-6
		{"0 5-6 * * *", false},     // hours 5-6 (current is 4)
	}

	for _, tt := range tests {
		got := cronMatches(tt.expr, ts)
		if got != tt.want {
			t.Errorf("cronMatches(%q, %v) = %v, want %v", tt.expr, ts, got, tt.want)
		}
	}
}
