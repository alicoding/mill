package main

import "testing"

func TestPercentile_Empty(t *testing.T) {
	if _, ok := Percentile(nil, 50); ok {
		t.Fatal("expected no data for empty input")
	}
}

func TestPercentile_Single(t *testing.T) {
	v, ok := Percentile([]float64{42}, 90)
	if !ok || v != 42 {
		t.Fatalf("got %v, %v; want 42, true", v, ok)
	}
}

func TestPercentile_P50Even(t *testing.T) {
	// [1,2,3,4] p50 via linear interpolation at rank 1.5 -> 2.5
	v, ok := Percentile([]float64{4, 1, 3, 2}, 50)
	if !ok {
		t.Fatal("expected data")
	}
	if v != 2.5 {
		t.Fatalf("got %v, want 2.5", v)
	}
}

func TestPercentile_P90(t *testing.T) {
	// [10,20,...,100], p90 at rank 8.1 -> 90 + 0.1*(100-90) = 91
	values := []float64{10, 20, 30, 40, 50, 60, 70, 80, 90, 100}
	v, ok := Percentile(values, 90)
	if !ok {
		t.Fatal("expected data")
	}
	if v != 91 {
		t.Fatalf("got %v, want 91", v)
	}
}

func TestPercentile_DoesNotMutateInput(t *testing.T) {
	values := []float64{5, 3, 1, 4, 2}
	original := append([]float64{}, values...)
	Percentile(values, 50)
	for i := range values {
		if values[i] != original[i] {
			t.Fatalf("input mutated: %v vs original %v", values, original)
		}
	}
}

func TestMean_Empty(t *testing.T) {
	if _, ok := Mean(nil); ok {
		t.Fatal("expected no data for empty input")
	}
}

func TestMean_Basic(t *testing.T) {
	v, ok := Mean([]float64{2, 4, 6})
	if !ok || v != 4 {
		t.Fatalf("got %v, %v; want 4, true", v, ok)
	}
}
