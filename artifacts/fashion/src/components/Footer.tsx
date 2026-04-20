import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export function Footer() {
  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Subscribed to the VELOUR newsletter");
  };

  return (
    <footer className="bg-[#1C1C1E] text-[#FAF9F6] py-16 md:py-24">
      <div className="container mx-auto px-4 grid grid-cols-1 md:grid-cols-12 gap-12">
        <div className="md:col-span-3 space-y-6">
          <h2 className="text-3xl font-serif tracking-tight">VELOUR</h2>
          <p className="text-gray-400 text-sm leading-relaxed max-w-sm">
            High-end futuristic women's fashion with an editorial edge. 
            Dress for the version of yourself you want to become.
          </p>
        </div>
        
        <div className="md:col-span-2 space-y-4">
          <h3 className="font-medium text-sm tracking-wider uppercase">Shop</h3>
          <ul className="space-y-3 text-sm text-gray-400">
            <li><a href="#" className="hover:text-white transition-colors">New Arrivals</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Collections</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Dresses</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Sale</a></li>
          </ul>
        </div>
        
        <div className="md:col-span-2 space-y-4">
          <h3 className="font-medium text-sm tracking-wider uppercase">Help</h3>
          <ul className="space-y-3 text-sm text-gray-400">
            <li><a href="#" className="hover:text-white transition-colors">FAQ</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Shipping</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Returns</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
          </ul>
        </div>

        <div className="md:col-span-2 space-y-4">
          <h3 className="font-medium text-sm tracking-wider uppercase">Follow Us</h3>
          <ul className="space-y-3 text-sm text-gray-400">
            <li><a href="#" className="hover:text-white transition-colors">Instagram</a></li>
            <li><a href="#" className="hover:text-white transition-colors">TikTok</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Pinterest</a></li>
            <li><a href="#" className="hover:text-white transition-colors">YouTube</a></li>
          </ul>
        </div>

        <div className="md:col-span-3 space-y-4">
          <h3 className="font-medium text-sm tracking-wider uppercase">Newsletter</h3>
          <p className="text-sm text-gray-400">Subscribe to receive updates, access to exclusive deals, and more.</p>
          <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-2 pt-2">
            <Input 
              type="email" 
              placeholder="Enter your email address" 
              required 
              className="bg-[#2C2C2E] border-gray-700 text-white placeholder:text-gray-500 focus-visible:ring-gray-500 rounded-none h-10"
            />
            <Button type="submit" variant="secondary" className="rounded-none h-10 w-full sm:w-auto uppercase text-xs tracking-wider font-semibold">
              Subscribe
            </Button>
          </form>
        </div>
      </div>
      <div className="container mx-auto px-4 mt-16 pt-8 border-t border-gray-800 text-xs text-gray-500 flex flex-col md:flex-row justify-between items-center">
        <p>&copy; {new Date().getFullYear()} VELOUR. All rights reserved.</p>
        <div className="flex space-x-6 mt-4 md:mt-0">
          <a href="#" className="hover:text-white transition-colors">Terms</a>
          <a href="#" className="hover:text-white transition-colors">Privacy</a>
          <a href="#" className="hover:text-white transition-colors">Cookies</a>
        </div>
      </div>
    </footer>
  );
}