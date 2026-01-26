#!/usr/bin/env python3
"""
Time Cost Profiler
A scoped time profiling utility for measuring function performance
"""

import time
from contextlib import contextmanager
from collections import defaultdict


class TimeProfiler:
    """Scoped time cost profiler for measuring function performance"""
    
    _profiles = defaultdict(list)  # Store all profile results
    _profile_tags = {}  # Map profile names to their tags
    _enabled = True  # Global enable/disable flag
    
    def __init__(self, name, verbose=True, tag=None):
        """
        Initialize a time profiler
        
        Args:
            name: Name/scope of the profiled section
            verbose: If True, print results immediately
            tag: Optional tag for categorizing this profiler
        """
        self.name = name
        self.verbose = verbose
        self.tag = tag
        self.start_time = None
        self.end_time = None
        self.duration = None
        
        # Store tag for this profile name
        if tag:
            TimeProfiler._profile_tags[name] = tag
    
    def __enter__(self):
        """Start profiling"""
        if TimeProfiler._enabled:
            self.start_time = time.perf_counter()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Stop profiling and record results"""
        if TimeProfiler._enabled:
            self.end_time = time.perf_counter()
            self.duration = self.end_time - self.start_time
            TimeProfiler._profiles[self.name].append(self.duration)
            
            if self.verbose:
                print(f"[PROFILE] {self.name}: {self.duration*1000:.2f}ms")
        
        return False  # Don't suppress exceptions
    
    @classmethod
    def get_stats(cls, name=None, tag=None):
        """
        Get profiling statistics
        
        Args:
            name: Profile name to get stats for, or None for all
            tag: Filter by tag, or None for all tags
        
        Returns:
            Dictionary with stats (count, total, avg, min, max, tag) or dict of all stats
        """
        if name:
            if name not in cls._profiles:
                return None
            durations = cls._profiles[name]
            if not durations:
                return None
            
            stats = {
                "count": len(durations),
                "total": sum(durations),
                "avg": sum(durations) / len(durations),
                "min": min(durations),
                "max": max(durations),
                "tag": cls._profile_tags.get(name, None)
            }
            return stats
        else:
            # Return stats for all profiles, optionally filtered by tag
            result = {}
            for n in cls._profiles.keys():
                if tag is None or cls._profile_tags.get(n) == tag:
                    result[n] = cls.get_stats(n)
            return result
    
    @classmethod
    def get_tags(cls):
        """Get all unique tags"""
        return set(cls._profile_tags.values())
    
    @classmethod
    def get_stats_by_tag(cls, tag):
        """Get all stats for profiles with a specific tag"""
        return cls.get_stats(tag=tag)
    
    @classmethod
    def print_summary(cls):
        """Print summary of all profiling results"""
        if not cls._profiles:
            print("[PROFILE] No profiling data collected")
            return
        
        print("\n" + "=" * 70)
        print("TIME PROFILING SUMMARY")
        print("=" * 70)
        
        for name in sorted(cls._profiles.keys()):
            stats = cls.get_stats(name)
            if stats:
                print(f"\n{name}:")
                print(f"  Calls:     {stats['count']}")
                print(f"  Total:     {stats['total']*1000:.2f}ms")
                print(f"  Average:   {stats['avg']*1000:.2f}ms")
                print(f"  Min:       {stats['min']*1000:.2f}ms")
                print(f"  Max:       {stats['max']*1000:.2f}ms")
        
        print("=" * 70 + "\n")
    
    @classmethod
    def clear(cls):
        """Clear all profiling data"""
        cls._profiles.clear()
        cls._profile_tags.clear()
    
    @classmethod
    def enable(cls):
        """Enable profiling"""
        cls._enabled = True
    
    @classmethod
    def disable(cls):
        """Disable profiling"""
        cls._enabled = False


@contextmanager
def profile_time(name, verbose=True, tag=None):
    """
    Context manager for time profiling
    
    Usage:
        with profile_time("my_function", tag="rendering"):
            # code to profile
            pass
    
    Args:
        name: Name/scope of the profiled section
        verbose: If True, print results immediately
        tag: Optional tag for categorizing this profiler
    
    Yields:
        TimeProfiler instance
    """
    profiler = TimeProfiler(name, verbose, tag=tag)
    with profiler:
        yield profiler
